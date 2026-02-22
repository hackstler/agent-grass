/**
 * RAG Retrieval Workflow — standalone, not used by the agent at runtime.
 *
 * The multi-query expansion logic here is integrated into the searchDocuments
 * tool (src/agent/tools/search-documents.ts) which the agent calls directly.
 *
 * This workflow is kept for:
 *   - Phase 2: direct /retrieve endpoint or agent.network() routing
 *   - Testing the retrieval pipeline independently of the agent
 *   - Reference implementation of the conditional expansion pattern
 */
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { transformQuery } from "../rag/query-transformer.js";
import { ragConfig } from "../config/rag.config.js";
import { defaultEmbedder, pgvectorRetriever, defaultReranker } from "../rag/adapters.js";
import type { ToolRegistryDeps } from "./tools/index.js";

const chunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  score: z.number(),
  documentTitle: z.string(),
  documentSource: z.string(),
});

const retrievalOutputSchema = z.object({
  query: z.string(),
  chunks: z.array(chunkSchema),
  chunkCount: z.number(),
  expanded: z.boolean(),
  orgId: z.string().optional(),
  documentIds: z.array(z.string()).optional(),
});

// ============================================================
// Factory: builds a RAG retrieval workflow with injected deps.
// Swap embedder / retriever / reranker without touching step logic.
// ============================================================
export function createRagRetrievalWorkflow(
  deps: Pick<ToolRegistryDeps, "embedder" | "retriever" | "reranker">
) {
  const { embedder, retriever, reranker } = deps;

  // ----------------------------------------------------------
  // Step 1: Initial retrieval
  // ----------------------------------------------------------
  const retrieveStep = createStep({
    id: "retrieve",
    inputSchema: z.object({
      query: z.string(),
      orgId: z.string().optional(),
      documentIds: z.array(z.string()).optional(),
    }),
    outputSchema: retrievalOutputSchema,
    execute: async ({ inputData }) => {
      const { query, orgId, documentIds } = inputData;
      const embedding = await embedder.embed(query);

      const opts = {
        topK: ragConfig.topK,
        similarityThreshold: ragConfig.similarityThreshold,
        ...(orgId ? { orgId } : {}),
        ...(documentIds?.length ? { documentIds } : {}),
      };

      let chunks = await retriever.retrieve(embedding, opts);
      if (ragConfig.enableReranking && chunks.length > 0) {
        chunks = await reranker.rerank(query, chunks, {
          topK: ragConfig.rerankTopK,
          provider: process.env["COHERE_API_KEY"] ? "cohere" : "local",
        });
      } else {
        chunks = chunks.slice(0, ragConfig.topK);
      }

      return {
        query,
        chunks: chunks.map((c) => ({
          id: c.id,
          content: c.content,
          score: c.score,
          documentTitle: c.documentTitle,
          documentSource: c.documentSource,
        })),
        chunkCount: chunks.length,
        expanded: false,
        orgId,
        documentIds,
      };
    },
  });

  // ----------------------------------------------------------
  // Step 2a: Expand query when < 3 chunks found
  // ----------------------------------------------------------
  const expandQueryStep = createStep({
    id: "expand-query",
    inputSchema: retrievalOutputSchema,
    outputSchema: retrievalOutputSchema,
    execute: async ({ inputData }) => {
      const { query, chunks: existingChunks, orgId, documentIds } = inputData;

      const expanded = await transformQuery(query, "multi-query", {
        complete: async (prompt: string) => {
          const { GoogleGenerativeAI } = await import("@google/generative-ai");
          const apiKey = (process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"])!;
          const googleAI = new GoogleGenerativeAI(apiKey);
          const model = googleAI.getGenerativeModel({
            model: process.env["GEMINI_MODEL"] ?? "gemini-2.5-flash",
          });
          const result = await model.generateContent(prompt);
          return result.response.text();
        },
      }, ragConfig.multiQueryCount);

      const embeddings = await Promise.all(expanded.queries.map((q) => embedder.embed(q)));

      const opts = {
        topK: ragConfig.topK,
        similarityThreshold: ragConfig.similarityThreshold * 0.8,
        ...(orgId ? { orgId } : {}),
        ...(documentIds?.length ? { documentIds } : {}),
      };

      const newChunks = await retriever.retrieveMultiQuery(embeddings, opts);

      const seen = new Map(existingChunks.map((c) => [c.id, c]));
      for (const c of newChunks) {
        const mapped = {
          id: c.id,
          content: c.content,
          score: c.score,
          documentTitle: c.documentTitle,
          documentSource: c.documentSource,
        };
        const existing = seen.get(c.id);
        if (!existing || c.score > existing.score) {
          seen.set(c.id, mapped);
        }
      }

      const merged = Array.from(seen.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, ragConfig.topK);

      return {
        query,
        chunks: merged,
        chunkCount: merged.length,
        expanded: true,
        orgId,
        documentIds,
      };
    },
  });

  // ----------------------------------------------------------
  // Step 2b: Pass-through when >= 3 chunks
  // ----------------------------------------------------------
  const sufficientContextStep = createStep({
    id: "sufficient-context",
    inputSchema: retrievalOutputSchema,
    outputSchema: retrievalOutputSchema,
    execute: async ({ inputData }) => ({ ...inputData, expanded: false }),
  });

  return createWorkflow({
    id: "rag-retrieval",
    inputSchema: z.object({
      query: z.string(),
      orgId: z.string().optional(),
      documentIds: z.array(z.string()).optional(),
    }),
    outputSchema: retrievalOutputSchema,
  })
    .then(retrieveStep)
    .branch([
      [async ({ inputData }) => inputData.chunkCount < 3, expandQueryStep],
      [async ({ inputData }) => inputData.chunkCount >= 3, sufficientContextStep],
    ])
    .commit();
}

// Default instance using production adapters
export const ragRetrievalWorkflow = createRagRetrievalWorkflow({
  embedder: defaultEmbedder,
  retriever: pgvectorRetriever,
  reranker: defaultReranker,
});
