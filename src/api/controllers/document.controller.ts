import { Hono } from "hono";
import { z } from "zod";
import type { DocumentManager } from "../../application/managers/document.manager.js";

const listDocumentsValidator = z.object({
  contentType: z.string().optional(),
  search: z.string().optional(),
});

export function createDocumentController(manager: DocumentManager): Hono {
  const router = new Hono();

  router.get("/", async (c) => {
    const user = c.get("user");
    const raw = listDocumentsValidator.parse(c.req.query());
    const filters: { contentType?: string; search?: string } = {};
    if (raw.contentType) filters.contentType = raw.contentType;
    if (raw.search) filters.search = raw.search;
    const rows = await manager.list(user?.orgId, filters);
    return c.json({ items: rows, total: rows.length });
  });

  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    await manager.delete(id, user?.orgId ?? "");
    return c.json({ id });
  });

  return router;
}
