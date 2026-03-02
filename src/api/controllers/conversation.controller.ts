import { Hono } from "hono";
import { z } from "zod";
import type { ConversationManager } from "../../application/managers/conversation.manager.js";

const listConversationsValidator = z.object({
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const createConversationValidator = z.object({
  userId: z.string().uuid().optional(),
  title: z.string().optional(),
});

export function createConversationController(manager: ConversationManager): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const filters = listConversationsValidator.parse(c.req.query());
    const result = await manager.list(filters);
    return c.json(result);
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createConversationValidator.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const conv = await manager.create(parsed.data);
    return c.json(conv, 201);
  });

  router.get("/:id", async (c) => {
    const id = c.req.param("id");
    const conv = await manager.getById(id);
    return c.json(conv);
  });

  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    await manager.delete(id);
    return c.json({ deleted: true, id });
  });

  return router;
}
