import { db } from "../db/client.js";
import { documents, documentChunks } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { ragConfig } from "../config/rag.config.js";
import { chunk, type ChunkerOptions } from "../rag/chunker.js";
import { createEmbedding } from "../rag/embeddings.js";
import type { LoadedDocument } from "./loader.js";
import type { NewDocument, NewDocumentChunk } from "../db/schema.js";

export interface ProcessResult {
  documentId: string;
  chunkCount: number;
  status: "indexed" | "failed";
  skipped?: boolean;
  error?: string;
}

/**
 * Process a loaded document: chunk → embed → store in DB.
 * Idempotent: if a document with the same source URL already exists,
 * deletes it (cascades to chunks) and re-indexes.
 */
export async function processDocument(
  loaded: LoadedDocument,
  orgId?: string,
  topicId?: string
): Promise<ProcessResult> {
  const source = loaded.metadata.source;

  // 1. Idempotency: delete existing document for this source (chunks cascade)
  const existing = await db.query.documents.findFirst({
    where: eq(documents.source, source),
    columns: { id: true },
  });

  if (existing) {
    console.log(`[processor] Re-ingesting existing document: ${source}`);
    await db.delete(documents).where(eq(documents.id, existing.id));
  }

  // 2. Create document record
  const [doc] = await db
    .insert(documents)
    .values({
      orgId,
      topicId: topicId ?? null,
      title: loaded.metadata.title,
      source,
      contentType: loaded.metadata.contentType,
      status: "processing",
      metadata: loaded.metadata,
    } satisfies NewDocument)
    .returning({ id: documents.id });

  const documentId = doc!.id;

  try {
    // 3. Choose chunking strategy — YouTube uses hierarchical to respect sections
    const chunkerOpts: ChunkerOptions = loaded.metadata.contentType === "youtube"
      ? { strategy: "hierarchical", chunkSize: ragConfig.chunkSize, chunkOverlap: ragConfig.chunkOverlap }
      : { strategy: ragConfig.chunkingStrategy, chunkSize: ragConfig.chunkSize, chunkOverlap: ragConfig.chunkOverlap };

    const chunks = chunk(loaded.content, chunkerOpts);

    if (chunks.length === 0) {
      throw new Error("Document produced no chunks after processing");
    }

    console.log(`[processor] ${source} → ${chunks.length} chunks (strategy: ${chunkerOpts.strategy})`);

    // 4. Create embeddings in batches to avoid rate limits
    const BATCH_SIZE = 20;
    const chunkValues: NewDocumentChunk[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const embeddings = await Promise.all(
        batch.map((c) => createEmbedding(c.content))
      );

      for (let j = 0; j < batch.length; j++) {
        const chunkData = batch[j]!;
        const embedding = embeddings[j]!;

        chunkValues.push({
          documentId,
          content: chunkData.content,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          embedding: embedding as unknown as any,
          chunkMetadata: chunkData.metadata,
        });
      }
    }

    // 5. Store chunks
    await db.insert(documentChunks).values(chunkValues);

    // 6. Mark as indexed
    await db
      .update(documents)
      .set({ status: "indexed", chunkCount: chunks.length, indexedAt: new Date() })
      .where(eq(documents.id, documentId));

    return { documentId, chunkCount: chunks.length, status: "indexed" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[processor] Failed: ${source} — ${errorMessage}`);

    await db
      .update(documents)
      .set({ status: "failed", metadata: { ...(loaded.metadata as Record<string, unknown>), error: errorMessage } })
      .where(eq(documents.id, documentId));

    return { documentId, chunkCount: 0, status: "failed", error: errorMessage };
  }
}
