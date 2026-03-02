import { Hono } from "hono";
import { z } from "zod";
import type { UserManager } from "../../application/managers/user.manager.js";
import { issueToken, type TokenPayload } from "../middleware/auth.js";

const registerValidator = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  orgId: z.string().optional(),
  role: z.enum(["admin", "user"]).default("user"),
});

const loginValidator = z.object({
  username: z.string(),
  password: z.string(),
});

export function createAuthController(manager: UserManager): Hono {
  const router = new Hono();

  /**
   * POST /auth/register
   * Creates a new user. First user is auto-admin; subsequent users require admin.
   */
  router.post("/register", async (c) => {
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

    const token = issueToken({
      userId: user.id,
      username: user.email!,
      orgId: user.orgId!,
      role,
    });

    return c.json(
      { token, user: { id: user.id, username: user.email!, orgId: user.orgId!, role } },
      201,
    );
  });

  /**
   * POST /auth/login
   * Body: { username, password } → returns JWT
   */
  router.post("/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = loginValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request" }, 400);
    }

    const { user, role } = await manager.login(parsed.data.username, parsed.data.password);

    const token = issueToken({
      userId: user.id,
      username: user.email!,
      orgId: user.orgId!,
      role,
    });

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

  return router;
}
