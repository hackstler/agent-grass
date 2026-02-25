import type { MiddlewareHandler, Context } from "hono";
import { sign, verify, type JwtPayload } from "jsonwebtoken";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TokenPayload extends JwtPayload {
  userId: string;
  username: string;
  orgId: string;
  role: "admin" | "user";
}

declare module "hono" {
  interface ContextVariableMap {
    user: TokenPayload;
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

    // Option 2: Bearer JWT (user sessions)
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ") && jwtSecret) {
      try {
        const token = authHeader.slice(7);
        const payload = verifyToken(token);
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
