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
    const orgId = user?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "Missing orgId" }, 401);
    const raw = listDocumentsValidator.parse(c.req.query());
    const filters: { contentType?: string; search?: string } = {};
    if (raw.contentType) filters.contentType = raw.contentType;
    if (raw.search) filters.search = raw.search;
    const rows = await manager.list(orgId, filters);
    return c.json({ items: rows, total: rows.length });
  });

  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const orgId = user?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "Missing orgId" }, 401);
    await manager.delete(id, orgId);
    return c.json({ id });
  });

  return router;
}
