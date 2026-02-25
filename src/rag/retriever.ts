import { db } from "../db/client.js";
import { documentChunks, documents } from "../db/schema.js";
import { sql, eq } from "drizzle-orm";
import type { DocumentChunk } from "../db/schema.js";
import type { RetrievedChunk, RetrieverOptions } from "./interfaces.js";

export type { RetrievedChunk, RetrieverOptions };

/**
 * Retrieve relevant chunks using cosine similarity search on pgvector.
 * Returns chunks ordered by similarity score (descending).
 */
export async function retrieve(
  queryEmbedding: number[],
  options: RetrieverOptions
): Promise<RetrievedChunk[]> {
  const { topK, similarityThreshold, orgId, documentIds, topicId } = options;

  // Build pgvector cosine similarity query
  // 1 - cosine_distance = cosine_similarity
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const result = await db.execute(sql`
    SELECT
      dc.id,
      dc.content,
      dc.document_id,
      dc.chunk_metadata,
      d.title as document_title,
      d.source as document_source,
      1 - (dc.embedding <=> ${embeddingStr}::vector) as similarity_score
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE
      dc.embedding IS NOT NULL
      AND d.status = 'indexed'
      ${orgId ? sql`AND d.org_id = ${orgId}` : sql``}
      ${documentIds?.length ? sql`AND dc.document_id = ANY(${documentIds}::uuid[])` : sql``}
      ${topicId ? sql`AND d.topic_id = ${topicId}::uuid` : sql``}
      AND 1 - (dc.embedding <=> ${embeddingStr}::vector) >= ${similarityThreshold}
    ORDER BY dc.embedding <=> ${embeddingStr}::vector
    LIMIT ${topK}
  `);

  return (result.rows as Array<{
    id: string;
    content: string;
    document_id: string;
    chunk_metadata: DocumentChunk["chunkMetadata"];
    document_title: string;
    document_source: string;
    similarity_score: number;
  }>).map((row) => ({
    id: row.id,
    content: row.content,
    score: Number(row.similarity_score),
    documentId: row.document_id,
    documentTitle: row.document_title,
    documentSource: row.document_source,
    metadata: row.chunk_metadata,
  }));
}

/**
 * Multi-query retrieval: run multiple queries and merge results with deduplication.
 * Improves recall by rephrasing the query from different angles.
 */
export async function retrieveMultiQuery(
  queryEmbeddings: number[][],
  options: RetrieverOptions
): Promise<RetrievedChunk[]> {
  const allResults = await Promise.all(
    queryEmbeddings.map((emb) =>
      retrieve(emb, { ...options, topK: options.topK * 2 })
    )
  );

  // Merge and deduplicate by chunk id, keeping highest score
  const seen = new Map<string, RetrievedChunk>();
  for (const results of allResults) {
    for (const chunk of results) {
      const existing = seen.get(chunk.id);
      if (!existing || chunk.score > existing.score) {
        seen.set(chunk.id, chunk);
      }
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, options.topK);
}
