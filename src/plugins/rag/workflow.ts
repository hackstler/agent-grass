/**
 * RAG Retrieval Workflow — thin wrapper around runRetrievalPipeline.
 *
 * Exposes the same pipeline used by the searchDocuments tool as a
 * Mastra Workflow for direct /retrieve endpoint usage, agent.network()
 * routing, and deterministic testing.
 */
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { ragConfig } from "./config/rag.config.js";
import { runRetrievalPipeline } from "./pipeline/retrieval-pipeline.js";
import { defaultEmbedder, pgvectorRetriever, defaultReranker } from "./pipeline/adapters.js";
import type { ToolRegistryDeps } from "./tools/index.js";

const chunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  score: z.number(),
  documentTitle: z.string(),
  documentSource: z.string(),
});

const inputSchema = z.object({
  query: z.string(),
  orgId: z.string(),
  documentIds: z.array(z.string()).optional(),
});

const retrievalOutputSchema = z.object({
  query: z.string(),
  chunks: z.array(chunkSchema),
  chunkCount: z.number(),
  expanded: z.boolean(),
  orgId: z.string(),
  documentIds: z.array(z.string()).optional(),
});

// ============================================================
// Factory: builds a RAG retrieval workflow with injected deps.
// Swap embedder / retriever / reranker without touching step logic.
// ============================================================
export function createRagRetrievalWorkflow(
  deps: Pick<ToolRegistryDeps, "embedder" | "retriever" | "reranker">
) {
  const retrieveStep = createStep({
    id: "retrieve",
    inputSchema,
    outputSchema: retrievalOutputSchema,
    execute: async ({ inputData }) => {
      const { query, orgId, documentIds } = inputData;
      const result = await runRetrievalPipeline(query, deps, {
        topK: ragConfig.topK,
        orgId,
        ...(documentIds?.length ? { documentIds } : {}),
      });
      return {
        query,
        chunks: result.chunks.map((c) => ({
          id: c.id,
          content: c.content,
          score: c.score,
          documentTitle: c.documentTitle,
          documentSource: c.documentSource,
        })),
        chunkCount: result.chunkCount,
        expanded: result.expanded,
        orgId,
        documentIds,
      };
    },
  });

  return createWorkflow({ id: "rag-retrieval", inputSchema, outputSchema: retrievalOutputSchema })
    .then(retrieveStep)
    .commit();
}

// Default instance using production adapters
export const ragRetrievalWorkflow = createRagRetrievalWorkflow({
  embedder: defaultEmbedder,
  retriever: pgvectorRetriever,
  reranker: defaultReranker,
});
