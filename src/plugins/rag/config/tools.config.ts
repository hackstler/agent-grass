/**
 * Tool registry configuration.
 *
 * enabled: true  → tool is registered and available to the agent
 * enabled: false → tool is excluded at startup, zero overhead
 *
 * To add a new tool:
 * 1. Create src/plugins/rag/tools/my-tool.ts (export myToolEntry)
 * 2. Add it to ALL_TOOLS in src/plugins/rag/tools/index.ts
 * 3. Add the key here
 */
export const toolsConfig = {
  searchDocuments: {
    enabled: true,
    description: "Semantic search over indexed documents (pgvector)",
  },
  searchWeb: {
    // Auto-disabled when PERPLEXITY_API_KEY is not set.
    // Force off with ENABLE_SEARCH_WEB=false even if key is present.
    enabled: Boolean(process.env["PERPLEXITY_API_KEY"]) &&
             process.env["ENABLE_SEARCH_WEB"] !== "false",
    description: "Web search fallback via Perplexity sonar (requires PERPLEXITY_API_KEY)",
  },
  saveNote: {
    enabled: true,
    description: "Ingest a YouTube URL into the knowledge base on demand",
  },
} satisfies Record<string, { enabled: boolean; description: string }>;

export type ToolKey = keyof typeof toolsConfig;
