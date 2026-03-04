import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { loadDocument } from "../ingestion/loader.js";
import { processDocument } from "../ingestion/processor.js";
import { db } from "../../../infrastructure/db/client.js";
import { documents } from "../../../infrastructure/db/schema.js";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const ingestUrlSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  topicId: z.string().uuid().optional(),
});

/**
 * Factory: creates ingest routes.
 */
export function createIngestRoutes(): Hono {
  const ingest = new Hono();

  /**
   * POST /ingest
   * Ingest a document from file upload (multipart) or URL (JSON body).
   */
  ingest.post("/", async (c) => {
    const contentType = c.req.header("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      return handleFileUpload(c);
    }

    if (contentType.includes("application/json")) {
      return handleUrlIngest(c);
    }

    return c.json(
      { error: "Content-Type must be multipart/form-data or application/json" },
      400
    );
  });

  /**
   * GET /ingest/status/:id
   * Check the status of an ingestion job.
   */
  ingest.get("/status/:id", async (c) => {
    const id = c.req.param("id");

    const doc = await db.query.documents.findFirst({
      where: eq(documents.id, id),
      columns: {
        id: true,
        title: true,
        status: true,
        chunkCount: true,
        indexedAt: true,
        createdAt: true,
        metadata: true,
      },
    });

    if (!doc) {
      return c.json({ error: "Document not found" }, 404);
    }

    return c.json(doc);
  });

  return ingest;
}

async function handleFileUpload(c: Context) {
  const body = await c.req.parseBody();
  const file = body["file"];
  const user = c.get("user");
  const orgId = user?.orgId;

  if (!orgId) return c.json({ error: "Unauthorized", message: "Missing orgId" }, 401);

  if (!(file instanceof File)) {
    return c.json({ error: "Missing 'file' field in form data" }, 400);
  }

  // Validate file size (50MB max)
  if (file.size > 50 * 1024 * 1024) {
    return c.json({ error: "File too large (max 50MB)" }, 400);
  }

  // Write to temp file
  const ext = file.name.split(".").pop() ?? "bin";
  const tmpPath = join(tmpdir(), `${randomUUID()}.${ext}`);

  try {
    const bytes = await file.arrayBuffer();
    await writeFile(tmpPath, Buffer.from(bytes));

    const loaded = await loadDocument(tmpPath);
    // Override title with original filename
    loaded.metadata.title = file.name.replace(/\.[^.]+$/, "");
    loaded.metadata.source = file.name;

    const result = await processDocument(loaded, orgId);

    return c.json({
      documentId: result.documentId,
      status: result.status,
      chunkCount: result.chunkCount,
      error: result.error,
    }, result.status === "indexed" ? 200 : 500);
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

async function handleUrlIngest(c: Context) {
  const body = await c.req.json();
  const parsed = ingestUrlSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  const { url, title, topicId } = parsed.data;
  const user = c.get("user");
  const orgId = user?.orgId;

  if (!orgId) return c.json({ error: "Unauthorized", message: "Missing orgId" }, 401);

  const loaded = await loadDocument(url);

  if (title) {
    loaded.metadata.title = title;
  }

  const result = await processDocument(loaded, orgId, topicId);

  return c.json({
    documentId: result.documentId,
    status: result.status,
    chunkCount: result.chunkCount,
    error: result.error,
  }, result.status === "indexed" ? 200 : 500);
}
