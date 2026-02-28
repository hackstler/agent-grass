import { Hono } from "hono";
import { db } from "../db/client.js";
import { documents, documentChunks } from "../db/schema.js";
import { eq, and, ilike, desc, type SQL } from "drizzle-orm";

const documentsRouter = new Hono();

/**
 * GET /documents?orgId=xxx&contentType=pdf&search=term
 * List documents, optionally filtered by orgId, contentType, and title search.
 */
documentsRouter.get("/", async (c) => {
  const orgId = c.req.query("orgId");
  const contentType = c.req.query("contentType");
  const search = c.req.query("search");

  const conditions: SQL[] = [];

  if (orgId) {
    conditions.push(eq(documents.orgId, orgId));
  }

  if (contentType) {
    conditions.push(eq(documents.contentType, contentType as typeof documents.contentType.enumValues[number]));
  }

  if (search) {
    conditions.push(ilike(documents.title, `%${search}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      topicId: documents.topicId,
      title: documents.title,
      source: documents.source,
      contentType: documents.contentType,
      status: documents.status,
      chunkCount: documents.chunkCount,
      metadata: documents.metadata,
      createdAt: documents.createdAt,
      indexedAt: documents.indexedAt,
    })
    .from(documents)
    .where(where)
    .orderBy(desc(documents.createdAt));

  return c.json({ items: rows, total: rows.length });
});

/**
 * DELETE /documents/:id
 * Delete a document and all its chunks (cascade).
 */
documentsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const [deleted] = await db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning({ id: documents.id });

  if (!deleted) {
    return c.json({ error: "Document not found" }, 404);
  }

  return c.json({ id: deleted.id });
});

export default documentsRouter;
