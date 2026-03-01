import { db } from "../db/client.js";
import { documents, documentChunks } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { ragConfig } from "../config/rag.config.js";
import { chunk, type ChunkerOptions } from "../rag/chunker.js";
import { createEmbedding } from "../rag/embeddings.js";
import { enrichDocument, resolveTopic } from "./enricher.js";
import { contextualizeChunks } from "./contextualizer.js";
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
 * Process a loaded document: enrich → chunk → contextualize → embed → store in DB.
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

  // 2. Enrich document with LLM-extracted metadata
  let enrichedMetadata = loaded.metadata as Record<string, unknown>;
  let resolvedTopicId = topicId ?? null;

  if (orgId) {
    try {
      console.log(`[processor] Enriching: ${source}`);
      const enrichment = await enrichDocument(loaded.content, enrichedMetadata);

      enrichedMetadata = {
        ...enrichedMetadata,
        summary: enrichment.summary,
        keywords: enrichment.keywords,
        entities: enrichment.entities,
        detectedLanguage: enrichment.language,
      };

      // 3. Resolve topic (auto-create if needed)
      if (!topicId && enrichment.suggestedTopic) {
        resolvedTopicId = await resolveTopic(orgId, enrichment.suggestedTopic);
        console.log(`[processor] Topic: "${enrichment.suggestedTopic}" → ${resolvedTopicId}`);
      }
    } catch (err) {
      console.warn(`[processor] Enrichment failed, continuing without: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Create document record
  const [doc] = await db
    .insert(documents)
    .values({
      orgId,
      topicId: resolvedTopicId,
      title: loaded.metadata.title,
      source,
      contentType: loaded.metadata.contentType,
      status: "processing",
      metadata: enrichedMetadata,
    } satisfies NewDocument)
    .returning({ id: documents.id });

  const documentId = doc!.id;

  try {
    // 5. Choose chunking strategy — YouTube uses hierarchical to respect sections
    const chunkerOpts: ChunkerOptions = loaded.metadata.contentType === "youtube"
      ? { strategy: "hierarchical", chunkSize: ragConfig.chunkSize, chunkOverlap: ragConfig.chunkOverlap }
      : { strategy: ragConfig.chunkingStrategy, chunkSize: ragConfig.chunkSize, chunkOverlap: ragConfig.chunkOverlap };

    const rawChunks = chunk(loaded.content, chunkerOpts);

    if (rawChunks.length === 0) {
      throw new Error("Document produced no chunks after processing");
    }

    console.log(`[processor] ${source} → ${rawChunks.length} chunks (strategy: ${chunkerOpts.strategy})`);

    // 6. Contextualize chunks with LLM-generated prefixes
    let contextualizedChunks: Array<{ content: string; contextPrefix: string; metadata: typeof rawChunks[0]["metadata"] }>;

    try {
      console.log(`[processor] Contextualizing ${rawChunks.length} chunks...`);
      const contextualized = await contextualizeChunks(loaded.content, rawChunks);
      contextualizedChunks = contextualized.map((c) => ({
        content: c.content,
        contextPrefix: c.contextPrefix,
        metadata: c.metadata,
      }));
    } catch (err) {
      console.warn(`[processor] Contextualization failed, continuing without: ${err instanceof Error ? err.message : String(err)}`);
      contextualizedChunks = rawChunks.map((c) => ({
        content: c.content,
        contextPrefix: "",
        metadata: c.metadata,
      }));
    }

    // 7. Create embeddings in batches — embed contextPrefix + content for better retrieval
    const BATCH_SIZE = 20;
    const chunkValues: NewDocumentChunk[] = [];

    for (let i = 0; i < contextualizedChunks.length; i += BATCH_SIZE) {
      const batch = contextualizedChunks.slice(i, i + BATCH_SIZE);
      const embeddings = await Promise.all(
        batch.map((c) => {
          const textToEmbed = c.contextPrefix
            ? `${c.contextPrefix}\n\n${c.content}`
            : c.content;
          return createEmbedding(textToEmbed);
        })
      );

      for (let j = 0; j < batch.length; j++) {
        const chunkData = batch[j]!;
        const embedding = embeddings[j]!;

        chunkValues.push({
          documentId,
          content: chunkData.content,
          contextPrefix: chunkData.contextPrefix || null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          embedding: embedding as unknown as any,
          chunkMetadata: chunkData.metadata,
        });
      }
    }

    // 8. Store chunks
    await db.insert(documentChunks).values(chunkValues);

    // 9. Populate search_vector for BM25 full-text search
    await db.execute(sql`
      UPDATE document_chunks
      SET search_vector = to_tsvector('spanish', coalesce(context_prefix, '') || ' ' || content)
      WHERE document_id = ${documentId}
    `);

    // 10. Mark as indexed
    await db
      .update(documents)
      .set({ status: "indexed", chunkCount: contextualizedChunks.length, indexedAt: new Date() })
      .where(eq(documents.id, documentId));

    return { documentId, chunkCount: contextualizedChunks.length, status: "indexed" };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[processor] Failed: ${source} — ${errorMessage}`);

    await db
      .update(documents)
      .set({ status: "failed", metadata: { ...(enrichedMetadata), error: errorMessage } })
      .where(eq(documents.id, documentId));

    return { documentId, chunkCount: 0, status: "failed", error: errorMessage };
  }
}
