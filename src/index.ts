import "dotenv/config";
import { serve } from "@hono/node-server";
import { ensurePgVector, runMigrations } from "./infrastructure/db/client.js";

// Infrastructure — repositories
import { DrizzleUserRepository } from "./infrastructure/repositories/drizzle-user.repository.js";
import { DrizzleDocumentRepository } from "./infrastructure/repositories/drizzle-document.repository.js";
import { DrizzleConversationRepository } from "./infrastructure/repositories/drizzle-conversation.repository.js";
import { DrizzleWhatsAppSessionRepository } from "./infrastructure/repositories/drizzle-whatsapp-session.repository.js";
import { DrizzleTopicRepository } from "./infrastructure/repositories/drizzle-topic.repository.js";
import { DrizzleOAuthTokenRepository } from "./infrastructure/repositories/drizzle-oauth-token.repository.js";
import { DrizzleOrganizationRepository } from "./infrastructure/repositories/drizzle-organization.repository.js";
import { DrizzleCatalogRepository } from "./infrastructure/repositories/drizzle-catalog.repository.js";
import { DrizzleInvitationRepository } from "./infrastructure/repositories/drizzle-invitation.repository.js";
import { DrizzleQuoteRepository } from "./infrastructure/repositories/drizzle-quote.repository.js";

// Application — managers
import { UserManager } from "./application/managers/user.manager.js";
import { DocumentManager } from "./application/managers/document.manager.js";
import { ConversationManager } from "./application/managers/conversation.manager.js";
import { WhatsAppManager } from "./application/managers/whatsapp.manager.js";
import { TopicManager } from "./application/managers/topic.manager.js";
import { OrganizationManager } from "./application/managers/organization.manager.js";
import { OAuthManager } from "./application/managers/oauth.manager.js";
import { CatalogManager } from "./application/managers/catalog.manager.js";
import { InvitationManager } from "./application/managers/invitation.manager.js";

// Plugins
import { PluginRegistry } from "./plugins/plugin-registry.js";
import { RagPlugin } from "./plugins/rag/index.js";
import { YouTubePlugin } from "./plugins/youtube/index.js";
import { GmailPlugin } from "./plugins/gmail/index.js";
import { CalendarPlugin } from "./plugins/calendar/index.js";
import { QuotePlugin } from "./plugins/quote/index.js";
import { CatalogManagerPlugin } from "./plugins/catalog-manager/index.js";
import { OAuthManagerAdapter } from "./plugins/google-common/oauth-manager-adapter.js";

// Shared stores
import { InMemoryAttachmentStore } from "./infrastructure/stores/in-memory-attachment-store.js";

// Coordinator agent
import { createCoordinatorAgent } from "./agent/coordinator.js";

// Auth strategy
import { authConfig } from "./config/auth.config.js";
import { createAuthStrategy } from "./infrastructure/auth/strategy-factory.js";
import { AesTokenEncryption } from "./infrastructure/crypto/token-encryption.js";

// App factory
import { createApp } from "./app.js";

// ── Composition root ───────────────────────────────────────────────────────────

// Password salt — same secret used for JWT signing (stable across restarts)
const PASSWORD_SALT = process.env["JWT_SECRET"] ?? "default-salt";

// 1. Repositories
const userRepo = new DrizzleUserRepository();
const docRepo = new DrizzleDocumentRepository();
const convRepo = new DrizzleConversationRepository();
const sessionRepo = new DrizzleWhatsAppSessionRepository();
const topicRepo = new DrizzleTopicRepository();
const oauthTokenRepo = new DrizzleOAuthTokenRepository();
const orgRepo = new DrizzleOrganizationRepository();
const catalogRepo = new DrizzleCatalogRepository();
const invitationRepo = new DrizzleInvitationRepository();
const quoteRepo = new DrizzleQuoteRepository();

// 2. Auth strategy (firebase or password — always non-null)
const authStrategy = createAuthStrategy(authConfig, PASSWORD_SALT, userRepo);

// 3. Managers
const userManager = new UserManager(userRepo, authStrategy);
const docManager = new DocumentManager(docRepo);
const convManager = new ConversationManager(convRepo);
const waManager = new WhatsAppManager(sessionRepo, userRepo);
const topicManager = new TopicManager(topicRepo);
const orgManager = new OrganizationManager(userRepo, docRepo, topicRepo, sessionRepo, orgRepo, catalogRepo, authStrategy);
const catalogManager = new CatalogManager(catalogRepo);
const invitationManager = new InvitationManager(invitationRepo, orgRepo, PASSWORD_SALT);
const tokenEncryption = new AesTokenEncryption();
const oauthManager = new OAuthManager(oauthTokenRepo, tokenEncryption);

// 4. Plugin registry
const pluginRegistry = new PluginRegistry();
const ragPlugin = new RagPlugin();
pluginRegistry.register(ragPlugin);

const oauthProvider = new OAuthManagerAdapter(oauthManager);
const attachmentStore = new InMemoryAttachmentStore();
pluginRegistry.register(new GmailPlugin(oauthProvider, attachmentStore));
pluginRegistry.register(new CalendarPlugin(oauthProvider));
pluginRegistry.register(new QuotePlugin({ attachmentStore, organizationRepo: orgRepo, quoteRepo }));
pluginRegistry.register(new CatalogManagerPlugin({ catalogManager, catalogRepo }));

// 5. Coordinator agent (uses all plugin tools + conversation history for sub-agents)
const coordinatorAgent = createCoordinatorAgent(pluginRegistry, convManager);

// Wire coordinator + convManager + memory into RAG plugin so /chat uses coordinator (enables Gmail/Calendar from dashboard)
ragPlugin.setCoordinatorAgent(coordinatorAgent);
ragPlugin.setConversationManager(convManager);
ragPlugin.setAttachmentStore(attachmentStore);

// 6. Create app
const app = createApp({
  userManager,
  docManager,
  convManager,
  waManager,
  topicManager,
  orgManager,
  coordinatorAgent,
  pluginRegistry,
  authConfig,
  authStrategy,
  oauthManager,
  catalogManager,
  invitationManager,
  quoteRepo,
  organizationRepo: orgRepo,
});

// ── Startup ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env["PORT"] ?? 3000);

async function main() {
  console.log(`[startup] booting rag-agent-backbone (port=${PORT}, node=${process.version})`);

  const googleKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!googleKey) {
    throw new Error(
      "Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY — required for embeddings and LLM"
    );
  }

  console.log("[startup] connecting to database...");
  await ensurePgVector();
  console.log("[startup] pgvector extension ready");

  await runMigrations();
  console.log("[startup] migrations applied");

  await pluginRegistry.ensureTablesForAll();

  await seedAdminUser();

  await pluginRegistry.initializeAll();

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[startup] rag-agent-backbone running on http://localhost:${PORT}`);
    console.log(`[startup] Environment: ${process.env["NODE_ENV"] ?? "development"}`);
  });
}

async function seedAdminUser() {
  if (!process.env["JWT_SECRET"]) return;

  const count = await userManager.countUsers();
  if (count > 0) return;

  if (authConfig.strategy === "firebase") {
    const email = process.env["ADMIN_EMAIL"];
    if (!email) return;
    await userManager.invite({ email, orgId: email, role: "super_admin" });
    console.log(`[startup] Admin user '${email}' created (firebase strategy)`);
  } else {
    const email = process.env["ADMIN_EMAIL"] ?? process.env["ADMIN_USERNAME"];
    const password = process.env["ADMIN_PASSWORD"];
    if (!email || !password) return;
    await userManager.create({ email, password, orgId: email, role: "super_admin" });
    console.log(`[startup] Admin user '${email}' created`);
  }
}

main().catch((err) => {
  console.error("[fatal] Failed to start server:", err);
  process.exit(1);
});

export default app;
