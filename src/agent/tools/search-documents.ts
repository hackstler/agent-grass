import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ragConfig } from "../../config/rag.config.js";
import { transformQuery } from "../../rag/query-transformer.js";
import type { ToolEntry, ToolRegistryDeps } from "./base.js";

const chunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  score: z.number(),
  documentTitle: z.string(),
  documentSource: z.string(),
});

/**
 * Search the knowledge base using semantic similarity.
 * Deps are injected — swap embedder/retriever/reranker without touching this file.
 */
export const searchDocumentsEntry: ToolEntry = {
  key: "searchDocuments",
  create: (deps) => createSearchDocumentsTool(deps),
};

export function createSearchDocumentsTool({ embedder, retriever, reranker }: ToolRegistryDeps) {
  return createTool({
    id: "search-documents",
    description: `Search the knowledge base for relevant document chunks using semantic similarity.
ALWAYS call this tool first before answering any question that may be in the knowledge base.
Returns the most relevant text passages ranked by relevance score.`,
    inputSchema: z.object({
      query: z.string().describe("The search query — can be the user's question or a reformulated version"),
      topK: z.number().optional().describe("Max results to return, defaults to config value"),
      orgId: z.string().optional(),
      documentIds: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
      chunks: z.array(chunkSchema),
      chunkCount: z.number(),
    }),
    execute: async ({ query, topK = ragConfig.topK, orgId, documentIds }) => {
      const embedding = await embedder.embed(query);

      const retrieverOptions = {
        topK: ragConfig.enableReranking ? topK * 3 : topK,
        similarityThreshold: ragConfig.similarityThreshold,
        ...(orgId ? { orgId } : {}),
        ...(documentIds?.length ? { documentIds } : {}),
      };

      let chunks = await retriever.retrieve(embedding, retrieverOptions);

      // Query expansion: when configured and initial retrieval is insufficient (< 3 chunks).
      // Uses multi-query / HyDE / step-back to broaden recall before reranking.
      if (ragConfig.queryEnhancement !== "none" && chunks.length < 3) {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const apiKey = (process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"])!;
        const googleAI = new GoogleGenerativeAI(apiKey);
        const llmModel = googleAI.getGenerativeModel({ model: ragConfig.llmModel });

        const expanded = await transformQuery(
          query,
          ragConfig.queryEnhancement,
          { complete: async (prompt) => (await llmModel.generateContent(prompt)).response.text() },
          ragConfig.multiQueryCount
        );

        if (expanded.queries.length > 1) {
          const embeddings = await Promise.all(expanded.queries.map((q) => embedder.embed(q)));
          const expandedOpts = {
            topK: ragConfig.enableReranking ? topK * 3 : topK,
            similarityThreshold: ragConfig.similarityThreshold * 0.8,
            ...(orgId ? { orgId } : {}),
            ...(documentIds?.length ? { documentIds } : {}),
          };

          const expandedChunks = await retriever.retrieveMultiQuery(embeddings, expandedOpts);

          // Merge initial + expanded results; keep highest score per chunk
          const seen = new Map(chunks.map((c) => [c.id, c]));
          for (const c of expandedChunks) {
            const existing = seen.get(c.id);
            if (!existing || c.score > existing.score) seen.set(c.id, c);
          }
          chunks = Array.from(seen.values()).sort((a, b) => b.score - a.score);
        }
      }

      if (ragConfig.enableReranking && chunks.length > 0) {
        chunks = await reranker.rerank(query, chunks, {
          topK: ragConfig.rerankTopK,
          provider: process.env["COHERE_API_KEY"] ? "cohere" : "local",
        });
      } else {
        chunks = chunks.slice(0, topK);
      }

      return {
        chunks: chunks.map((c) => ({
          id: c.id,
          content: c.content,
          score: c.score,
          documentTitle: c.documentTitle,
          documentSource: c.documentSource,
        })),
        chunkCount: chunks.length,
      };
    },
  });
}
