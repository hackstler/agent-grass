import { Hono } from "hono";
import { cors } from "hono/cors";
import { pinoLogger } from "hono-pino";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "./shared/logger.js";
import { authMiddleware, optionalAuth, requireRole, requirePermission, requireWorker } from "./api/middleware/auth.js";
import { errorHandler, domainErrorToHttpStatus } from "./api/middleware/error-handler.middleware.js";
import { DomainError } from "./domain/errors/index.js";

import type { UserManager } from "./application/managers/user.manager.js";
import type { DocumentManager } from "./application/managers/document.manager.js";
import type { ConversationManager } from "./application/managers/conversation.manager.js";
import type { WhatsAppManager } from "./application/managers/whatsapp.manager.js";
import type { TopicManager } from "./application/managers/topic.manager.js";
import type { OrganizationManager } from "./application/managers/organization.manager.js";
import type { AgentRunner } from "./agent/agent-runner.js";
import type { PluginRegistry } from "./plugins/plugin-registry.js";
import type { AuthConfig } from "./config/auth.config.js";
import type { AuthStrategy } from "./domain/ports/auth-strategy.js";
import type { OAuthManager } from "./application/managers/oauth.manager.js";
import type { CatalogManager } from "./application/managers/catalog.manager.js";
import type { InvitationManager } from "./application/managers/invitation.manager.js";
import type { QuoteRepository } from "./domain/ports/repositories/quote.repository.js";
import type { OrganizationRepository } from "./domain/ports/repositories/organization.repository.js";
import { createAuthController } from "./api/controllers/auth.controller.js";
import { createDocumentController } from "./api/controllers/document.controller.js";
import { createConversationController } from "./api/controllers/conversation.controller.js";
import { createChannelController } from "./api/controllers/channel.controller.js";
import { createInternalController } from "./api/controllers/internal.controller.js";
import { createAdminController } from "./api/controllers/admin.controller.js";
import { createTopicController } from "./api/controllers/topic.controller.js";
import { createOAuthController } from "./api/controllers/oauth.controller.js";
import { createCatalogController } from "./api/controllers/catalog.controller.js";
import { createQuoteController } from "./api/controllers/quote.controller.js";
import { createWebhookController } from "./api/controllers/webhook.controller.js";
import { createEmailController } from "./api/controllers/email.controller.js";
import health from "./api/health.js";
import type { WhatsAppChannel } from "./domain/ports/whatsapp-channel.js";
import type { AttachmentStore } from "./domain/ports/attachment-store.js";
import type { GmailApiService } from "./plugins/gmail/services/gmail-api.service.js";

export interface AppDependencies {
  userManager: UserManager;
  docManager: DocumentManager;
  convManager: ConversationManager;
  waManager: WhatsAppManager;
  topicManager: TopicManager;
  orgManager: OrganizationManager;
  coordinatorAgent: AgentRunner;
  pluginRegistry?: PluginRegistry;
  authConfig: AuthConfig;
  authStrategy: AuthStrategy;
  oauthManager?: OAuthManager;
  catalogManager?: CatalogManager;
  invitationManager?: InvitationManager;
  quoteRepo?: QuoteRepository;
  organizationRepo?: OrganizationRepository;
  userRepo?: import("./domain/ports/repositories/user.repository.js").UserRepository;
  whatsappChannel?: WhatsAppChannel;
  attachmentStore?: AttachmentStore;
  gmailService?: GmailApiService;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  // ── Global middleware ────────────────────────────────────────────────────────
  app.use(pinoLogger({ pino: logger }));
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: process.env["ALLOWED_ORIGINS"]?.split(",") ?? "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
      exposeHeaders: ["X-Conversation-Id"],
    })
  );
  app.use("*", errorHandler());

  // ── Routes ─────────────────────────────────────────────────────────────────
  app.route("/health", health);

  const auth = authMiddleware();
  app.use("/auth/me", auth);
  app.use("/auth/profile", auth);
  app.use("/auth/register", optionalAuth());
  // Public routes: register-with-invite and invite/validate need no auth
  // OAuth routes: authorize, status, disconnect require auth; callback does NOT (Google redirect)
  app.use("/auth/google/authorize", auth);
  app.use("/auth/google/status", auth);
  app.use("/auth/google/disconnect", auth);
  app.route("/auth", createAuthController(deps.userManager, deps.authConfig, deps.authStrategy, deps.invitationManager, deps.organizationRepo));
  if (deps.oauthManager) {
    app.route("/auth", createOAuthController(deps.oauthManager));
  }

  // Auth middleware BEFORE plugin routes (plugins mount /chat, /ingest, etc.)
  app.use("/ingest/*", auth);
  app.use("/ingest/*", requirePermission("manage_knowledge"));
  app.use("/chat/*", auth);
  app.use("/conversations/*", auth);
  app.use("/topics/*", auth);
  app.use("/topics/*", requirePermission("view_knowledge"));
  app.use("/documents/*", auth);
  app.use("/documents/*", requirePermission("view_knowledge"));

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

  // Org info for current user (any authenticated user can see their own org)
  app.get("/org/me", auth, async (c) => {
    const user = c.get("user");
    if (!user?.orgId) return c.json({ error: "BadRequest", message: "Missing orgId" }, 400);
    try {
      const org = await deps.orgManager.getByOrgId(user.orgId);
      return c.json({ data: org });
    } catch {
      return c.json({ data: null });
    }
  });

  // Admin endpoints — granular permission guards per route group
  app.use("/admin/*", auth);
  app.use("/admin/users/*", requirePermission("view_org_users"));
  app.use("/admin/invitations/*", requirePermission("view_org_users"));
  app.use("/admin/organizations/*", requirePermission("view_own_org"));
  app.use("/admin/whatsapp/*", requirePermission("view_whatsapp_mgmt"));
  app.route("/admin", createAdminController(deps.userManager, deps.orgManager, deps.authConfig, deps.waManager, deps.invitationManager));
  if (deps.catalogManager) {
    app.use("/admin/catalogs/*", requirePermission("manage_catalogs"));
    app.route("/admin/catalogs", createCatalogController(deps.catalogManager, deps.organizationRepo));
  }

  // Email draft confirmation — authenticated user
  if (deps.gmailService && deps.attachmentStore) {
    app.use("/emails/*", auth);
    app.route("/emails", createEmailController(deps.gmailService, deps.attachmentStore));
  }

  // Quotes — authenticated user
  if (deps.quoteRepo) {
    app.use("/quotes/*", auth);
    app.route("/quotes", createQuoteController(deps.quoteRepo));
  }

  // Kapso WhatsApp webhooks — NO auth middleware (uses HMAC signature verification internally)
  if (deps.whatsappChannel && deps.organizationRepo && deps.userRepo && deps.attachmentStore) {
    app.route("/webhooks", createWebhookController(
      deps.coordinatorAgent, deps.convManager, deps.organizationRepo,
      deps.userRepo, deps.whatsappChannel, deps.attachmentStore, deps.gmailService,
    ));
  }

  // Internal worker endpoints — worker JWT auth
  const workerAuth = requireWorker();
  app.use("/internal/*", workerAuth);
  app.route("/internal", createInternalController(deps.waManager, deps.convManager, deps.coordinatorAgent, deps.attachmentStore!));

  // ── 404 + error fallback ─────────────────────────────────────────────────────
  app.notFound((c) => c.json({ error: "NotFound", message: "Not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      const status = domainErrorToHttpStatus(err) as 400 | 401 | 403 | 404 | 409;
      const category = err.constructor.name.replace(/Error$/, "");
      return c.json({ error: category, message: err.message }, status);
    }
    logger.error({ err }, "Unhandled error");
    return c.json({ error: "InternalError", message: err.message }, 500);
  });

  return app;
}
