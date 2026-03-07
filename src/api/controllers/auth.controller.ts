import { Hono } from "hono";
import { z } from "zod";
import type { UserManager } from "../../application/managers/user.manager.js";
import type { InvitationManager } from "../../application/managers/invitation.manager.js";
import type { AuthConfig } from "../../config/auth.config.js";
import type { AuthStrategy } from "../../domain/ports/auth-strategy.js";
import { issueToken, type TokenPayload } from "../middleware/auth.js";
import { ForbiddenError } from "../../domain/errors/index.js";

const updateProfileValidator = z.object({
  email: z.string().email().max(255).optional(),
  name: z.string().max(100).optional(),
  surname: z.string().max(100).optional(),
  password: z.string().min(8).optional(),
  onboardingComplete: z.boolean().optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

const registerWithInviteValidator = z.object({
  inviteToken: z.string().min(1),
  idToken: z.string().min(1).optional(),
  email: z.string().email().max(255).optional(),
  password: z.string().min(8).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

const registerValidator = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8),
  name: z.string().max(100).optional(),
  surname: z.string().max(100).optional(),
  orgId: z.string().optional(),
  role: z.enum(["admin", "user", "super_admin"]).default("user"),
});

const passwordLoginValidator = z.object({
  email: z.string(),
  password: z.string(),
});

const firebaseLoginValidator = z.object({
  idToken: z.string().min(1),
});

export function createAuthController(
  manager: UserManager,
  authConfig: AuthConfig,
  strategy: AuthStrategy,
  invitationManager?: InvitationManager,
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
    const { email, password, name, surname, role: rawRole } = parsed.data;
    const dto: Parameters<typeof manager.register>[0] = { email, password, name, surname, role: rawRole };
    if (parsed.data.orgId) dto.orgId = parsed.data.orgId;
    const { user, role } = await manager.register(dto, caller?.role);

    const token = issueToken(
      { userId: user.id, email: user.email!, orgId: user.orgId!, role },
      authConfig.jwtTtl,
    );

    return c.json(
      { token, user: { id: user.id, email: user.email!, orgId: user.orgId!, role } },
      201,
    );
  });

  /**
   * POST /auth/login
   * Mutually exclusive strategies:
   *   - firebase: only accepts { idToken }
   *   - password: only accepts { email, password }
   */
  router.post("/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Bad Request" }, 400);

    if (authConfig.strategy === "firebase") {
      // Firebase strategy: only accept idToken
      const parsed = firebaseLoginValidator.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Bad Request", message: "Firebase login requires idToken" }, 400);
      }

      const authResult = await strategy.authenticate({ type: "token", token: parsed.data.idToken });
      const found = await manager.findByEmailWithRole(authResult.email);
      if (!found) {
        return c.json(
          { error: "Unauthorized", message: "No account found for this email. Contact your admin." },
          401,
        );
      }

      const { user, role } = found;
      const token = issueToken(
        { userId: user.id, email: user.email!, orgId: user.orgId!, role },
        authConfig.jwtTtl,
      );

      return c.json({
        token,
        user: { id: user.id, email: user.email!, orgId: user.orgId!, role },
      });
    }

    // Password strategy: only accept email + password
    const parsed = passwordLoginValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request", message: "Password login requires email and password" }, 400);
    }

    const { user, role } = await manager.login(parsed.data.email, parsed.data.password);
    const token = issueToken(
      { userId: user.id, email: user.email!, orgId: user.orgId!, role },
      authConfig.jwtTtl,
    );

    return c.json({ token, user: { id: user.id, email: user.email!, orgId: user.orgId!, role } });
  });

  /**
   * POST /auth/register-with-invite
   * Public endpoint. Registers a new user using an invitation token.
   *   - firebase: requires idToken (password goes to Firebase, never our backend)
   *   - password: requires email + password
   */
  router.post("/register-with-invite", async (c) => {
    if (!invitationManager) {
      return c.json({ error: "InternalError", message: "Invitation system not configured" }, 500);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = registerWithInviteValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
    }

    const { inviteToken, idToken, email: bodyEmail, password, firstName, lastName } = parsed.data;

    // Validate invitation token
    const validation = await invitationManager.validateToken(inviteToken);
    if (!validation.valid) {
      const statusCode = validation.reason === "expired" ? 410 : 400;
      return c.json({ error: "InvalidInvitation", message: `Invitation ${validation.reason}` }, statusCode);
    }

    // Determine email based on auth strategy
    let email: string;

    if (authConfig.strategy === "firebase") {
      // Firebase: requires idToken
      if (!idToken) {
        return c.json({ error: "Bad Request", message: "Firebase registration requires idToken" }, 400);
      }
      const authResult = await strategy.authenticate({ type: "token", token: idToken });
      email = authResult.email;
    } else {
      // Password: requires email + password
      if (!bodyEmail || !password) {
        return c.json({ error: "Bad Request", message: "Password registration requires email and password" }, 400);
      }
      email = bodyEmail;
    }

    // If invitation has email hint, verify it matches
    if (validation.email && validation.email !== email) {
      return c.json({ error: "Bad Request", message: "Email does not match invitation" }, 400);
    }

    // Create user
    const { user, role } = await manager.registerWithInvite({
      email,
      password: authConfig.strategy === "password" ? password : undefined,
      firstName,
      lastName,
      orgId: validation.orgId,
      role: validation.role,
    });

    // Mark invitation as used
    await invitationManager.markUsed(validation.invitation.id, user.id);

    // Issue JWT
    const token = issueToken(
      { userId: user.id, email: user.email!, orgId: user.orgId!, role: role as "admin" | "user" | "super_admin" },
      authConfig.jwtTtl,
    );

    return c.json(
      { token, user: { id: user.id, email: user.email!, orgId: user.orgId!, role } },
      201,
    );
  });

  /**
   * GET /auth/invite/validate?token=xxx
   * Public endpoint. Validates an invitation token without consuming it.
   */
  router.get("/invite/validate", async (c) => {
    if (!invitationManager) {
      return c.json({ valid: false, reason: "invalid" }, 400);
    }

    const token = c.req.query("token");
    if (!token) {
      return c.json({ valid: false, reason: "invalid" }, 400);
    }

    const result = await invitationManager.validateToken(token);
    if (!result.valid) {
      const statusCode = result.reason === "expired" ? 410 : 400;
      return c.json({ valid: false, reason: result.reason }, statusCode);
    }

    return c.json({
      valid: true,
      orgId: result.orgId,
      orgName: result.orgName,
      role: result.role,
      email: result.email,
    });
  });

  /**
   * GET /auth/me
   * Returns current user info from the Bearer token.
   */
  router.get("/me", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const fullUser = await manager.getById(user.userId);
    const meta = fullUser.metadata as Record<string, unknown> | null;
    return c.json({
      userId: user.userId,
      email: user.email,
      name: fullUser.name,
      surname: fullUser.surname,
      orgId: user.orgId,
      role: user.role,
      onboardingComplete: meta?.["onboardingComplete"] !== false, // default true for existing users
      firstName: meta?.["firstName"] ?? null,
      lastName: meta?.["lastName"] ?? null,
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

    // Reject password change in firebase mode
    if (parsed.data.password && !strategy.supportsPasswordManagement()) {
      return c.json(
        { error: "Forbidden", message: "Password management is not available with Firebase authentication" },
        403,
      );
    }

    try {
      const { onboardingComplete, firstName, lastName, ...rest } = parsed.data;
      const updated = await manager.updateSelf(user.userId, {
        ...rest,
        onboardingComplete,
        firstName,
        lastName,
      });
      return c.json({ data: updated });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return c.json({ error: "Forbidden", message: err.message }, 403);
      }
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
