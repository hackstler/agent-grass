import { Hono } from "hono";
import { z } from "zod";
import type { TopicManager } from "../../application/managers/topic.manager.js";

const createTopicValidator = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

const updateTopicValidator = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
});

export function createTopicController(manager: TopicManager): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized — no orgId in token" }, 401);
    const rows = await manager.list(orgId);
    return c.json({ items: rows, total: rows.length });
  });

  router.post("/", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized — no orgId in token" }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = createTopicValidator.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const topic = await manager.create(orgId, parsed.data.name, parsed.data.description);
    return c.json(topic, 201);
  });

  router.patch("/:id", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized — no orgId in token" }, 401);

    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = updateTopicValidator.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates["name"] = parsed.data.name;
    if (parsed.data.description !== undefined) updates["description"] = parsed.data.description;
    if (Object.keys(updates).length === 0) return c.json({ error: "No fields to update" }, 400);

    const updated = await manager.update(id, orgId, updates as Parameters<typeof manager.update>[2]);
    return c.json(updated);
  });

  router.delete("/:id", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized — no orgId in token" }, 401);
    const id = c.req.param("id");
    await manager.delete(id, orgId);
    return c.json({ id });
  });

  router.get("/:id/documents", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized — no orgId in token" }, 401);
    const id = c.req.param("id");
    const rows = await manager.getDocuments(id, orgId);
    return c.json({ items: rows, total: rows.length });
  });

  return router;
}
