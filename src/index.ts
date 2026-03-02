import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { ensurePgVector, runMigrations } from "./infrastructure/db/client.js";
import { authMiddleware, optionalAuth, requireRole, requireWorker } from "./api/middleware/auth.js";
import { errorHandler, domainErrorToHttpStatus } from "./api/middleware/error-handler.middleware.js";
import { DomainError } from "./domain/errors/index.js";

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

// API — controllers (factory functions)
import { createAuthController } from "./api/controllers/auth.controller.js";
import { createDocumentController } from "./api/controllers/document.controller.js";
import { createConversationController } from "./api/controllers/conversation.controller.js";
import { createChannelController } from "./api/controllers/channel.controller.js";
import { createInternalController } from "./api/controllers/internal.controller.js";
import { createAdminController } from "./api/controllers/admin.controller.js";
import { createTopicController } from "./api/controllers/topic.controller.js";

// Plugins
import { PluginRegistry } from "./plugins/plugin-registry.js";
import { RagPlugin } from "./plugins/rag/index.js";

// API — health (standalone, not plugin-specific)
import health from "./api/health.js";

const app = new Hono();

// ── Global middleware ──────────────────────────────────────────────────────────
app.use("*", logger());
app.use("*", secureHeaders());
app.use(
  "*",
  cors({
    origin: process.env["ALLOWED_ORIGINS"]?.split(",") ?? "*",
    allowMethods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  })
);
app.use("*", errorHandler());

// ── Plugin registry ───────────────────────────────────────────────────────────

const pluginRegistry = new PluginRegistry();
const ragPlugin = new RagPlugin();
pluginRegistry.register(ragPlugin);

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

// ── Routes ─────────────────────────────────────────────────────────────────────

app.route("/health", health);                              // public

const auth = authMiddleware();
app.use("/auth/me", auth);
app.use("/auth/register", optionalAuth());
app.route("/auth", createAuthController(userManager));

app.use("/ingest/*", auth);
app.use("/chat/*", auth);
app.use("/conversations/*", auth);
app.use("/topics/*", auth);
app.use("/documents/*", auth);

// Plugin routes (chat, ingest) — mounted at same paths as before
pluginRegistry.mountRoutes(app);

app.route("/conversations", createConversationController(convManager));
app.route("/topics", createTopicController(topicManager));
app.route("/documents", createDocumentController(docManager));

// WhatsApp channels — user-facing
app.use("/channels/*", auth);
app.route("/channels", createChannelController(waManager));

// Admin endpoints — require admin role
app.use("/admin/*", auth);
app.use("/admin/*", requireRole("admin"));
app.route("/admin", createAdminController(userManager, orgManager));

// Internal worker endpoints — worker JWT auth
const workerAuth = requireWorker();
app.use("/internal/*", workerAuth);
app.route("/internal", createInternalController(waManager, convManager, ragPlugin.agent));

// ── 404 + error fallback ───────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: "NotFound", message: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof DomainError) {
    const status = domainErrorToHttpStatus(err) as 400 | 401 | 403 | 404 | 409;
    const category = err.constructor.name.replace(/Error$/, "");
    return c.json({ error: category, message: err.message }, status);
  }
  console.error("[error]", err);
  return c.json({ error: "InternalError", message: err.message }, 500);
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
