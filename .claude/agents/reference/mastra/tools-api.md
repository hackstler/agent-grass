# Mastra Tools API Reference

## createTool()

```typescript
import { createTool } from "@mastra/core/tools"
import { z } from "zod"

const myTool = createTool({
  id: "my-tool",                // kebab-case, unique identifier
  description: "What this tool does",  // agent reads this to decide when to use
  inputSchema: z.object({       // Zod schema — validated before execute()
    query: z.string(),
    limit: z.number().optional(),
  }),
  outputSchema: z.object({      // Zod schema — validated after execute()
    results: z.array(z.string()),
    count: z.number(),
  }),
  execute: async (input) => {
    // input is typed from inputSchema
    return { results: [...], count: 5 }
  },
})
```

## This Project's Tool Pattern

### ToolEntry Interface (`src/agent/tools/base.ts`)
```typescript
export interface ToolRegistryDeps {
  embedder: IEmbedder
  retriever: IRetriever
  reranker: IReranker
}

export interface ToolEntry {
  key: string                              // config key, e.g., "searchDocuments"
  create(deps: ToolRegistryDeps): MastraTool  // factory function
}
```

### Tool Implementation Example (`src/agent/tools/search-documents.ts`)
```typescript
export const searchDocumentsEntry: ToolEntry = {
  key: "searchDocuments",
  create: (deps) => createSearchDocumentsTool(deps),
}

export function createSearchDocumentsTool({ embedder, retriever, reranker }: ToolRegistryDeps) {
  return createTool({
    id: "search-documents",
    description: `Search the knowledge base for relevant document chunks...`,
    inputSchema: z.object({
      query: z.string(),
      topK: z.number().optional(),
      orgId: z.string().optional(),
      documentIds: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
      chunks: z.array(chunkSchema),
      chunkCount: z.number(),
    }),
    execute: async ({ query, topK, orgId, documentIds }) => {
      const { chunks, chunkCount } = await runRetrievalPipeline(query, { embedder, retriever, reranker }, { topK, orgId, documentIds })
      return { chunks: chunks.map(c => ({ ... })), chunkCount }
    },
  })
}
```

### Registry (`src/agent/tools/index.ts`)
```typescript
const ALL_TOOLS: ToolEntry[] = [
  searchDocumentsEntry,
  searchWebEntry,
  saveNoteEntry,
]

export function createToolRegistry(deps: ToolRegistryDeps) {
  return Object.fromEntries(
    ALL_TOOLS
      .filter(t => toolsConfig[t.key]?.enabled)
      .map(t => [t.key, t.create(deps)])
  )
}
```

### Config (`src/config/tools.config.ts`)
```typescript
export const toolsConfig = {
  searchDocuments: { enabled: true, description: "..." },
  searchWeb: { enabled: Boolean(process.env["PERPLEXITY_API_KEY"]), description: "..." },
  saveNote: { enabled: true, description: "..." },
}
```

## Adding a New Tool

1. Create `src/agent/tools/my-tool.ts`:
   - Export `myToolEntry: ToolEntry`
   - Implement factory function with Zod schemas
2. Add to `ALL_TOOLS` array in `src/agent/tools/index.ts`
3. Add config entry in `src/config/tools.config.ts`
4. Done — no other files need modification (OCP)

## Tool Description Best Practices

The agent uses the `description` to decide WHEN to call a tool. Be specific:

```typescript
// Good: tells agent exactly when to use this tool
description: "Search the knowledge base for relevant document chunks using semantic similarity. ALWAYS call this tool first before answering any question that may be in the knowledge base."

// Bad: vague, agent doesn't know when to use
description: "Search for documents"
```

## Payload Wrapping (Mastra 1.5+)

Tool results in `generate()` steps and `stream()` events are wrapped in `.payload`:

```typescript
// Extracting tool results from agent.generate() response
const steps = result.steps ?? []
const allToolResults = steps.flatMap(s => s.toolResults ?? [])

// Each tool result is wrapped
const searchResult = allToolResults.find(r => {
  const payload = (r as { payload?: { toolName?: string } }).payload
  return payload?.toolName === "searchDocuments"
})

// Access the actual result
const data = (searchResult as { payload: { result?: unknown } }).payload.result
```

This is handled by `src/api/helpers/extract-sources.ts` in this project.
