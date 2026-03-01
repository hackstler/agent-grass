import { GoogleGenerativeAI } from "@google/generative-ai";
import { ragConfig } from "../config/rag.config.js";
import { transformQuery } from "./query-transformer.js";
import type { ToolRegistryDeps } from "../agent/tools/base.js";
import type { RetrievalPipelineOptions, RetrievalPipelineResult } from "./interfaces.js";

export async function runRetrievalPipeline(
  query: string,
  deps: ToolRegistryDeps,
  options: RetrievalPipelineOptions = {}
): Promise<RetrievalPipelineResult> {
  const { embedder, retriever, reranker } = deps;
  const topK = options.topK ?? ragConfig.topK;

  // Step 1: embed
  const embedding = await embedder.embed(query);

  // Step 2: retrieve (inflate topK when reranking to give reranker more candidates)
  const retrieverOptions = {
    topK: ragConfig.enableReranking ? topK * 3 : topK,
    similarityThreshold: ragConfig.similarityThreshold,
    ...(options.orgId ? { orgId: options.orgId } : {}),
    ...(options.documentIds?.length ? { documentIds: options.documentIds } : {}),
    ...(options.topicId ? { topicId: options.topicId } : {}),
  };

  // Step 2b: use hybrid search (vector + BM25) when queryText is available
  let chunks = options.queryText
    ? await retriever.retrieveHybrid(embedding, options.queryText, retrieverOptions)
    : await retriever.retrieve(embedding, retrieverOptions);
  let expanded = false;

  // Step 3: query expansion when configured and initial recall is low
  if (ragConfig.queryEnhancement !== "none" && chunks.length < 3) {
    const apiKey = (process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"])!;
    const llmModel = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: ragConfig.llmModel });
    const llmClient = {
      complete: async (prompt: string) => (await llmModel.generateContent(prompt)).response.text(),
    };

    const { queries } = await transformQuery(query, ragConfig.queryEnhancement, llmClient, ragConfig.multiQueryCount);

    if (queries.length > 1) {
      const embeddings = await Promise.all(queries.map((q) => embedder.embed(q)));
      const expandedChunks = await retriever.retrieveMultiQuery(embeddings, {
        ...retrieverOptions,
        similarityThreshold: ragConfig.similarityThreshold * 0.8,
      });

      const seen = new Map(chunks.map((c) => [c.id, c]));
      for (const c of expandedChunks) {
        const existing = seen.get(c.id);
        if (!existing || c.score > existing.score) seen.set(c.id, c);
      }
      chunks = Array.from(seen.values()).sort((a, b) => b.score - a.score);
      expanded = true;
    }
  }

  // Step 4: rerank or slice
  if (ragConfig.enableReranking && chunks.length > 0) {
    chunks = await reranker.rerank(query, chunks, {
      topK,
      provider: process.env["COHERE_API_KEY"] ? "cohere" : "local",
    });
  } else {
    chunks = chunks.slice(0, topK);
  }

  return { chunks, chunkCount: chunks.length, expanded };
}
