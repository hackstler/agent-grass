import type { RetrievedChunk, RerankerOptions } from "./interfaces.js";

export type { RerankerOptions };

/**
 * Rerank retrieved chunks using a cross-encoder model.
 * Improves precision by ~20-35% at the cost of ~200ms latency.
 */
export async function rerank(
  query: string,
  chunks: RetrievedChunk[],
  options: RerankerOptions
): Promise<RetrievedChunk[]> {
  if (chunks.length === 0) return chunks;

  switch (options.provider) {
    case "cohere":
      return rerankWithCohere(query, chunks, options.topK);
    case "local":
      return rerankLocal(query, chunks, options.topK);
    default:
      return chunks.slice(0, options.topK);
  }
}

/**
 * Cohere reranker — production quality cross-encoder.
 * Requires COHERE_API_KEY environment variable.
 */
async function rerankWithCohere(
  query: string,
  chunks: RetrievedChunk[],
  topK: number
): Promise<RetrievedChunk[]> {
  const apiKey = process.env["COHERE_API_KEY"];
  if (!apiKey) {
    console.warn("[reranker] COHERE_API_KEY not set, skipping reranking");
    return chunks.slice(0, topK);
  }

  const response = await fetch("https://api.cohere.ai/v1/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "rerank-english-v3.0",
      query,
      documents: chunks.map((c) => c.content),
      top_n: topK,
    }),
  });

  if (!response.ok) {
    console.error("[reranker] Cohere API error:", response.statusText);
    return chunks.slice(0, topK);
  }

  const data = (await response.json()) as {
    results: Array<{ index: number; relevance_score: number }>;
  };

  return data.results.map((result) => ({
    ...chunks[result.index]!,
    score: result.relevance_score,
  }));
}

/**
 * Simple local reranker using keyword overlap scoring.
 * No external API required, but lower quality than cross-encoder.
 */
function rerankLocal(
  query: string,
  chunks: RetrievedChunk[],
  topK: number
): RetrievedChunk[] {
  const queryTerms = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3)
  );

  const scored = chunks.map((chunk) => {
    const chunkTerms = chunk.content.toLowerCase().split(/\s+/);
    const overlap = chunkTerms.filter((t) => queryTerms.has(t)).length;
    const termScore = queryTerms.size > 0 ? overlap / queryTerms.size : 0;

    // Weighted combination of embedding score and term overlap
    const combinedScore = chunk.score * 0.7 + termScore * 0.3;
    return { ...chunk, score: combinedScore };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
