import { Hono } from "hono";
import { z } from "zod";
import type { UserManager } from "../../application/managers/user.manager.js";
import type { AuthConfig } from "../../config/auth.config.js";
import type { AuthStrategy } from "../../domain/ports/auth-strategy.js";
import { issueToken, type TokenPayload } from "../middleware/auth.js";

const updateProfileValidator = z.object({
  email: z.string().email().max(255).optional(),
  password: z.string().min(8).optional(),
});

const registerValidator = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  orgId: z.string().optional(),
  role: z.enum(["admin", "user", "super_admin"]).default("user"),
});

const passwordLoginValidator = z.object({
  username: z.string(),
  password: z.string(),
});

const firebaseLoginValidator = z.object({
  idToken: z.string().min(1),
});

export function createAuthController(
  manager: UserManager,
  authConfig: AuthConfig,
  strategy: AuthStrategy | null,
): Hono {
  const router = new Hono();

  /**
   * POST /auth/register
   * Creates a new user. First user is auto-admin; subsequent users require admin.
   * Disabled when AUTH_STRATEGY=firebase (users are managed via Firebase + invite).
   */
  router.post("/register", async (c) => {
    if (authConfig.strategy === "firebase") {
      return c.json(
        { error: "Forbidden", message: "Registration is handled via Firebase" },
        403,
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = registerValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const caller = c.get("user") as TokenPayload | undefined;
    const { username, password, role: rawRole } = parsed.data;
    const dto: Parameters<typeof manager.register>[0] = { username, password, role: rawRole };
    if (parsed.data.orgId) dto.orgId = parsed.data.orgId;
    const { user, role } = await manager.register(dto, caller?.role);

    const token = issueToken(
      { userId: user.id, username: user.email!, orgId: user.orgId!, role },
      authConfig.jwtTtl,
    );

    return c.json(
      { token, user: { id: user.id, username: user.email!, orgId: user.orgId!, role } },
      201,
    );
  });

  /**
   * POST /auth/login
   * - password strategy: { username, password } → JWT
   * - firebase strategy: { idToken } → verify Firebase token → JWT
   */
  router.post("/login", async (c) => {
    const body = await c.req.json().catch(() => null);

    // Firebase strategy: verify ID token, find user by email, issue local JWT
    if (authConfig.strategy === "firebase" && strategy) {
      const parsed = firebaseLoginValidator.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: "Validation", message: "Body must contain { idToken: string }" },
          400,
        );
      }

      const authResult = await strategy.verifyToken(parsed.data.idToken);
      const found = await manager.findByEmailWithRole(authResult.email);
      if (!found) {
        return c.json(
          { error: "Unauthorized", message: "No account found for this email. Contact your admin." },
          401,
        );
      }

      const { user, role } = found;
      const token = issueToken(
        { userId: user.id, username: user.email!, orgId: user.orgId!, role },
        authConfig.jwtTtl,
      );

      return c.json({
        token,
        user: { id: user.id, username: user.email!, orgId: user.orgId!, role },
      });
    }

    // Password strategy: existing flow
    const parsed = passwordLoginValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request" }, 400);
    }

    const { user, role } = await manager.login(parsed.data.username, parsed.data.password);
    const token = issueToken(
      { userId: user.id, username: user.email!, orgId: user.orgId!, role },
      authConfig.jwtTtl,
    );

    return c.json({ token, user: { id: user.id, username: user.email!, orgId: user.orgId!, role } });
  });

  /**
   * GET /auth/me
   * Returns current user info from the Bearer token.
   */
  router.get("/me", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({
      userId: user.userId,
      username: user.username,
      orgId: user.orgId,
      role: user.role,
    });
  });

  /**
   * PATCH /auth/profile
   * Update the authenticated user's own profile (email and/or password).
   * Requires authMiddleware() — any authenticated user can update themselves.
   */
  router.patch("/profile", async (c) => {
    const user = c.get("user") as TokenPayload | undefined;
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = updateProfileValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
    }

    try {
      const updated = await manager.updateSelf(user.userId, parsed.data);
      return c.json({ data: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update failed";
      if (message === "User not found") {
        return c.json({ error: "NotFound", message }, 404);
      }
      if (message === "Email already in use") {
        return c.json({ error: "Conflict", message }, 409);
      }
      return c.json({ error: "InternalError", message }, 500);
    }
  });

  return router;
}
