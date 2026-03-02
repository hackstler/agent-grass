import { Hono } from "hono";
import { z } from "zod";
import type { UserManager } from "../../application/managers/user.manager.js";
import type { OrganizationManager } from "../../application/managers/organization.manager.js";
import type { TokenPayload } from "../middleware/auth.js";

const listUsersValidator = z.object({
  orgId: z.string().optional(),
  search: z.string().optional(),
});

const createUserValidator = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  orgId: z.string().min(1),
  role: z.enum(["admin", "user"]).default("user"),
});

const createOrgValidator = z.object({
  orgId: z.string().min(1).max(100),
  adminUsername: z.string().min(3).max(50),
  adminPassword: z.string().min(8),
});

export function createAdminController(
  userManager: UserManager,
  orgManager: OrganizationManager,
): Hono {
  const router = new Hono();

  // ── Users CRUD ──────────────────────────────────────────────────────────────

  router.get("/users", async (c) => {
    const raw = listUsersValidator.parse(c.req.query());
    const filters: { orgId?: string; search?: string } = {};
    if (raw.orgId) filters.orgId = raw.orgId;
    if (raw.search) filters.search = raw.search;
    const items = await userManager.listAll(filters);
    return c.json({ items, total: items.length });
  });

  router.post("/users", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createUserValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
    }
    const user = await userManager.create(parsed.data);
    return c.json(user, 201);
  });

  router.delete("/users/:id", async (c) => {
    const id = c.req.param("id");
    const caller = c.get("user") as TokenPayload;
    await userManager.delete(id, caller.userId);
    return c.json({ ok: true });
  });

  // ── Organizations CRUD ──────────────────────────────────────────────────────

  router.get("/organizations", async (c) => {
    const items = await orgManager.list();
    return c.json({ items });
  });

  router.post("/organizations", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createOrgValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
    }
    const result = await orgManager.create(parsed.data);
    return c.json(result, 201);
  });

  router.delete("/organizations/:orgId", async (c) => {
    const orgId = c.req.param("orgId");
    const caller = c.get("user") as TokenPayload;
    await orgManager.delete(orgId, caller.orgId);
    return c.json({ ok: true });
  });

  return router;
}
