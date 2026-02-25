import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ragConfig } from "../../config/rag.config.js";
import { runRetrievalPipeline } from "../../rag/retrieval-pipeline.js";
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
      const { chunks, chunkCount } = await runRetrievalPipeline(
        query,
        { embedder, retriever, reranker },
        {
          topK,
          ...(orgId ? { orgId } : {}),
          ...(documentIds?.length ? { documentIds } : {}),
        }
      );
      return {
        chunks: chunks.map((c) => ({
          id: c.id,
          content: c.content,
          score: c.score,
          documentTitle: c.documentTitle,
          documentSource: c.documentSource,
        })),
        chunkCount,
      };
    },
  });
}
