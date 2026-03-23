import { Hono } from "hono";
import { logger } from "../../shared/logger.js";
import type { OAuthManager } from "../../application/managers/oauth.manager.js";

export function createOAuthController(oauthManager: OAuthManager): Hono {
  const router = new Hono();

  // GET /google/authorize — requires auth (user JWT)
  router.get("/google/authorize", async (c) => {
    const user = c.get("user");
    const frontendUrl = c.req.query("redirectTo");
    const authorizeUrl = oauthManager.getAuthorizeUrl(user.userId, frontendUrl);
    return c.json({ data: { authorizeUrl } });
  });

  // GET /google/callback — NO AUTH (Google redirect)
  router.get("/google/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.json({ error: "Validation", message: "Missing code or state parameter" }, 400);
    }

    try {
      const { frontendUrl } = await oauthManager.handleCallback(code, state);
      const base = frontendUrl || process.env["FRONTEND_URL"] || "http://localhost:5174";
      return c.redirect(`${base}?googleConnected=true`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      logger.error({ err: msg }, "OAuth callback error");
      const base = process.env["FRONTEND_URL"] || "http://localhost:5174";
      return c.redirect(`${base}?googleError=${encodeURIComponent(msg)}`);
    }
  });

  // GET /google/status — requires auth
  router.get("/google/status", async (c) => {
    const user = c.get("user");
    const status = await oauthManager.getStatus(user.userId);
    return c.json({ data: status });
  });

  // POST /google/disconnect — requires auth
  router.post("/google/disconnect", async (c) => {
    const user = c.get("user");
    await oauthManager.disconnect(user.userId);
    return c.json({ data: { disconnected: true } });
  });

  return router;
}
