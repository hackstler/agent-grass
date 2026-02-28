import type { MiddlewareHandler, Context } from "hono";
import jwt from "jsonwebtoken";
const { sign, verify } = jwt;
import type { JwtPayload } from "jsonwebtoken";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TokenPayload extends JwtPayload {
  userId: string;
  username: string;
  orgId: string;
  role: "admin" | "user";
}

export interface WorkerTokenPayload extends JwtPayload {
  role: "worker";
  orgId: string;
}

declare module "hono" {
  interface ContextVariableMap {
    user: TokenPayload;
    workerOrgId: string;
  }
}

// ── JWT helpers ────────────────────────────────────────────────────────────────

export function issueToken(payload: Omit<TokenPayload, keyof JwtPayload>): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET env var is required to issue tokens");
  return sign(payload, secret, { expiresIn: "7d" });
}

export function verifyToken(token: string): TokenPayload {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET not configured");
  return verify(token, secret) as TokenPayload;
}

// ── Middleware ─────────────────────────────────────────────────────────────────

/**
 * Auth middleware — accepts either:
 *   • X-API-Key header (machine-to-machine, e.g. WhatsApp listener)
 *   • Authorization: Bearer <jwt> (user sessions from dashboard)
 *
 * If neither API_KEY nor JWT_SECRET is configured, auth is disabled (dev mode).
 */
export function authMiddleware(): MiddlewareHandler {
  const apiKey = process.env["API_KEY"];
  const jwtSecret = process.env["JWT_SECRET"];

  if (!apiKey && !jwtSecret) {
    console.warn("[auth] Neither API_KEY nor JWT_SECRET set — authentication disabled");
    return async (_c, next) => next();
  }

  return async (c, next) => {
    // Option 1: X-API-Key (backwards compatible, machine-to-machine)
    const xApiKey = c.req.header("X-API-Key");
    if (apiKey && xApiKey === apiKey) {
      await next();
      return;
    }

    // Option 2: Bearer JWT (user sessions — reject worker tokens)
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ") && jwtSecret) {
      try {
        const token = authHeader.slice(7);
        const payload = verifyToken(token);
        // Reject worker tokens — they must use /internal/* routes with requireWorker()
        if ((payload as Record<string, unknown>)["role"] === "worker") {
          return c.json({ error: "Forbidden", message: "Worker tokens cannot access user routes" }, 403);
        }
        c.set("user", payload);
        await next();
        return;
      } catch {
        return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
      }
    }

    return c.json({ error: "Unauthorized", message: "Provide X-API-Key header or Bearer token" }, 401);
  };
}

// ── Optional auth ─────────────────────────────────────────────────────────────

/**
 * Parses JWT if present but does NOT reject unauthenticated requests.
 * Sets c.var.user when a valid token is provided, leaves it undefined otherwise.
 * Use for routes that behave differently depending on auth (e.g. /auth/register).
 */
export function optionalAuth(): MiddlewareHandler {
  return async (c, next) => {
    const jwtSecret = process.env["JWT_SECRET"];
    const authHeader = c.req.header("Authorization");
    if (jwtSecret && authHeader?.startsWith("Bearer ")) {
      try {
        const payload = verifyToken(authHeader.slice(7));
        if ((payload as Record<string, unknown>)["role"] !== "worker") {
          c.set("user", payload);
        }
      } catch { /* invalid token — treat as unauthenticated */ }
    }
    await next();
  };
}

// ── requireRole guard ──────────────────────────────────────────────────────────

/**
 * Use after authMiddleware() to restrict an endpoint to specific roles.
 * Example: app.post("/admin/users", authMiddleware(), requireRole("admin"), handler)
 */
export function requireRole(...roles: Array<"admin" | "user">): MiddlewareHandler {
  return async (c: Context, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ error: "Forbidden", message: `Requires role: ${roles.join(" or ")}` }, 403);
    }
    await next();
  };
}

// ── requireWorker guard ────────────────────────────────────────────────────────

/**
 * Middleware for /internal/* routes — only accepts JWTs with role: "worker".
 * Extracts orgId from the token and sets c.var.workerOrgId.
 */
export function requireWorker(): MiddlewareHandler {
  return async (c, next) => {
    const jwtSecret = process.env["JWT_SECRET"];
    if (!jwtSecret) {
      return c.json({ error: "JWT_SECRET not configured" }, 500);
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized", message: "Bearer token required" }, 401);
    }

    try {
      const token = authHeader.slice(7);
      const payload = verify(token, jwtSecret) as Record<string, unknown>;

      if (payload["role"] !== "worker") {
        return c.json({ error: "Forbidden", message: "Worker token required" }, 403);
      }

      const orgId = payload["orgId"];
      if (typeof orgId !== "string" || !orgId) {
        return c.json({ error: "Forbidden", message: "Missing orgId in worker token" }, 403);
      }

      c.set("workerOrgId", orgId);
      await next();
    } catch {
      return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
    }
  };
}
