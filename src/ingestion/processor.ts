import { db } from "../db/client.js";
import { documents, documentChunks } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { ragConfig } from "../config/rag.config.js";
import { chunk } from "../rag/chunker.js";
import { createEmbedding } from "../rag/embeddings.js";
import type { LoadedDocument } from "./loader.js";
import type { NewDocument, NewDocumentChunk } from "../db/schema.js";

export interface ProcessResult {
  documentId: string;
  chunkCount: number;
  status: "indexed" | "failed";
  error?: string;
}

/**
 * Process a loaded document: chunk → embed → store in DB.
 * Updates document status throughout the pipeline.
 */
export async function processDocument(
  loaded: LoadedDocument,
  orgId?: string
): Promise<ProcessResult> {
  // 1. Create document record
  const [doc] = await db
    .insert(documents)
    .values({
      orgId,
      title: loaded.metadata.title,
      source: loaded.metadata.source,
      contentType: loaded.metadata.contentType,
      status: "processing",
      metadata: loaded.metadata,
    } satisfies NewDocument)
    .returning({ id: documents.id });

  const documentId = doc!.id;

  try {
    // 2. Chunk the document
    const chunks = chunk(loaded.content, {
      strategy: ragConfig.chunkingStrategy,
      chunkSize: ragConfig.chunkSize,
      chunkOverlap: ragConfig.chunkOverlap,
    });

    if (chunks.length === 0) {
      throw new Error("Document produced no chunks after processing");
    }

    // 3. Create embeddings (batch to avoid rate limits)
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
          embedding: embedding as unknown as any, // pgvector: number[] at runtime; Drizzle vector column type mismatch
          chunkMetadata: chunkData.metadata,
        });
      }
    }

    // 4. Store chunks in DB
    await db.insert(documentChunks).values(chunkValues);

    // 5. Mark document as indexed
    await db
      .update(documents)
      .set({
        status: "indexed",
        chunkCount: chunks.length,
        indexedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    return { documentId, chunkCount: chunks.length, status: "indexed" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db
      .update(documents)
      .set({ status: "failed", metadata: { ...(loaded.metadata as Record<string, unknown>), error: errorMessage } })
      .where(eq(documents.id, documentId));

    return {
      documentId,
      chunkCount: 0,
      status: "failed",
      error: errorMessage,
    };
  }
}
