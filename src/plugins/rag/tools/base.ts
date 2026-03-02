import type { IEmbedder, IRetriever, IReranker } from "../pipeline/interfaces.js";

/**
 * Dependencies injected into RAG-aware tools.
 */
export interface ToolRegistryDeps {
  embedder: IEmbedder;
  retriever: IRetriever;
  reranker: IReranker;
}

/**
 * Self-registering tool entry.
 *
 * Pattern for adding a new tool:
 * 1. Create `src/plugins/rag/tools/my-tool.ts`
 * 2. Export `myToolEntry: ToolEntry` + the factory function
 * 3. Add to ALL_TOOLS in `tools/index.ts`   ← one line
 * 4. Add key in `config/tools.config.ts`    ← one line
 *
 * Tools that don't need RAG deps can ignore the `deps` parameter.
 */
export interface ToolEntry {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create: (deps: ToolRegistryDeps) => any;
}
