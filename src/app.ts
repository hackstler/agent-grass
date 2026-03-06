import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { authMiddleware, optionalAuth, requireRole, requireWorker } from "./api/middleware/auth.js";
import { errorHandler, domainErrorToHttpStatus } from "./api/middleware/error-handler.middleware.js";
import { DomainError } from "./domain/errors/index.js";

import type { UserManager } from "./application/managers/user.manager.js";
import type { DocumentManager } from "./application/managers/document.manager.js";
import type { ConversationManager } from "./application/managers/conversation.manager.js";
import type { WhatsAppManager } from "./application/managers/whatsapp.manager.js";
import type { TopicManager } from "./application/managers/topic.manager.js";
import type { OrganizationManager } from "./application/managers/organization.manager.js";
import type { Agent } from "@mastra/core/agent";
import type { PluginRegistry } from "./plugins/plugin-registry.js";
import type { AuthConfig } from "./config/auth.config.js";
import type { AuthStrategy } from "./domain/ports/auth-strategy.js";
import type { OAuthManager } from "./application/managers/oauth.manager.js";
import type { CatalogManager } from "./application/managers/catalog.manager.js";

import { createAuthController } from "./api/controllers/auth.controller.js";
import { createDocumentController } from "./api/controllers/document.controller.js";
import { createConversationController } from "./api/controllers/conversation.controller.js";
import { createChannelController } from "./api/controllers/channel.controller.js";
import { createInternalController } from "./api/controllers/internal.controller.js";
import { createAdminController } from "./api/controllers/admin.controller.js";
import { createTopicController } from "./api/controllers/topic.controller.js";
import { createOAuthController } from "./api/controllers/oauth.controller.js";
import { createCatalogController } from "./api/controllers/catalog.controller.js";
import health from "./api/health.js";

export interface AppDependencies {
  userManager: UserManager;
  docManager: DocumentManager;
  convManager: ConversationManager;
  waManager: WhatsAppManager;
  topicManager: TopicManager;
  orgManager: OrganizationManager;
  coordinatorAgent: Agent;
  pluginRegistry?: PluginRegistry;
  authConfig: AuthConfig;
  authStrategy: AuthStrategy | null;
  oauthManager?: OAuthManager;
  catalogManager?: CatalogManager;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // ── Global middleware ────────────────────────────────────────────────────────
  app.use("*", logger());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: process.env["ALLOWED_ORIGINS"]?.split(",") ?? "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    })
  );
  app.use("*", errorHandler());

  // ── Routes ─────────────────────────────────────────────────────────────────
  app.route("/health", health);

  const auth = authMiddleware();
  app.use("/auth/me", auth);
  app.use("/auth/register", optionalAuth());
  // OAuth routes: authorize, status, disconnect require auth; callback does NOT (Google redirect)
  app.use("/auth/google/authorize", auth);
  app.use("/auth/google/status", auth);
  app.use("/auth/google/disconnect", auth);
  app.route("/auth", createAuthController(deps.userManager, deps.authConfig, deps.authStrategy));
  if (deps.oauthManager) {
    app.route("/auth", createOAuthController(deps.oauthManager));
  }

  // Auth middleware BEFORE plugin routes (plugins mount /chat, /ingest, etc.)
  app.use("/ingest/*", auth);
  app.use("/chat/*", auth);
  app.use("/conversations/*", auth);
  app.use("/topics/*", auth);
  app.use("/documents/*", auth);

  // ── Plugin routes (after auth middleware) ──────────────────────────────────
  if (deps.pluginRegistry) {
    deps.pluginRegistry.mountRoutes(app);
  }

  app.route("/conversations", createConversationController(deps.convManager));
  app.route("/topics", createTopicController(deps.topicManager));
  app.route("/documents", createDocumentController(deps.docManager));

  // WhatsApp channels — user-facing
  app.use("/channels/*", auth);
  app.route("/channels", createChannelController(deps.waManager));

  // Admin endpoints — require admin role
  app.use("/admin/*", auth);
  app.use("/admin/*", requireRole("admin"));
  app.route("/admin", createAdminController(deps.userManager, deps.orgManager, deps.authConfig));
  if (deps.catalogManager) {
    app.route("/admin/catalogs", createCatalogController(deps.catalogManager));
  }

  // Internal worker endpoints — worker JWT auth
  const workerAuth = requireWorker();
  app.use("/internal/*", workerAuth);
  app.route("/internal", createInternalController(deps.waManager, deps.convManager, deps.coordinatorAgent));

  // ── 404 + error fallback ─────────────────────────────────────────────────────
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

  return app;
}
