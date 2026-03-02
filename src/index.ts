import "dotenv/config";
import { serve } from "@hono/node-server";
import { ensurePgVector, runMigrations } from "./infrastructure/db/client.js";

// Infrastructure — repositories
import { DrizzleUserRepository } from "./infrastructure/repositories/drizzle-user.repository.js";
import { DrizzleDocumentRepository } from "./infrastructure/repositories/drizzle-document.repository.js";
import { DrizzleConversationRepository } from "./infrastructure/repositories/drizzle-conversation.repository.js";
import { DrizzleWhatsAppSessionRepository } from "./infrastructure/repositories/drizzle-whatsapp-session.repository.js";
import { DrizzleTopicRepository } from "./infrastructure/repositories/drizzle-topic.repository.js";

// Application — managers
import { UserManager } from "./application/managers/user.manager.js";
import { DocumentManager } from "./application/managers/document.manager.js";
import { ConversationManager } from "./application/managers/conversation.manager.js";
import { WhatsAppManager } from "./application/managers/whatsapp.manager.js";
import { TopicManager } from "./application/managers/topic.manager.js";
import { OrganizationManager } from "./application/managers/organization.manager.js";

// Plugins
import { PluginRegistry } from "./plugins/plugin-registry.js";
import { RagPlugin } from "./plugins/rag/index.js";
import { QuotePlugin } from "./plugins/quote/index.js";

// Coordinator agent
import { createCoordinatorAgent } from "./agent/coordinator.js";

// Catalog seed
import { seedCatalog } from "./infrastructure/db/seed.js";

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

// 2. Managers
const userManager = new UserManager(userRepo, PASSWORD_SALT);
const docManager = new DocumentManager(docRepo);
const convManager = new ConversationManager(convRepo);
const waManager = new WhatsAppManager(sessionRepo, userRepo);
const topicManager = new TopicManager(topicRepo);
const orgManager = new OrganizationManager(userRepo, docRepo, topicRepo, sessionRepo, PASSWORD_SALT);

// 3. Plugin registry
const pluginRegistry = new PluginRegistry();
const ragPlugin = new RagPlugin();
pluginRegistry.register(ragPlugin);
pluginRegistry.register(new QuotePlugin());

// 4. Coordinator agent (uses all plugin tools)
const coordinatorAgent = createCoordinatorAgent(pluginRegistry);

// 5. Create app
const app = createApp({
  userManager,
  docManager,
  convManager,
  waManager,
  topicManager,
  orgManager,
  coordinatorAgent,
  pluginRegistry,
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

  await seedAdminUser();

  const adminOrg = process.env["ADMIN_USERNAME"] ?? "default";
  await seedCatalog(adminOrg);

  await pluginRegistry.initializeAll();

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[startup] rag-agent-backbone running on http://localhost:${PORT}`);
    console.log(`[startup] Environment: ${process.env["NODE_ENV"] ?? "development"}`);
  });
}

async function seedAdminUser() {
  const username = process.env["ADMIN_USERNAME"];
  const password = process.env["ADMIN_PASSWORD"];

  if (!username || !password || !process.env["JWT_SECRET"]) return;

  const count = await userManager.countUsers();
  if (count > 0) return;

  await userManager.create({ username, password, orgId: username, role: "admin" });
  console.log(`[startup] Admin user '${username}' created`);
}

main().catch((err) => {
  console.error("[fatal] Failed to start server:", err);
  process.exit(1);
});

export default app;
