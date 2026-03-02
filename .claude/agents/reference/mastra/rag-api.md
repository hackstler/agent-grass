# Mastra RAG API Reference

## Document Processing

```typescript
import { MDocument } from "@mastra/rag"

// From text
const doc = MDocument.fromText(content)

// Chunking
const chunks = await doc.chunk({
  strategy: "recursive",    // "character" | "token" | "recursive" | "markdown" | "html"
  size: 512,                // target chunk size in tokens
  overlap: 50,              // overlap between chunks
})
// Returns: Array<{ content: string, metadata: { chunkIndex, startChar, endChar } }>
```

### Chunking Strategies

| Strategy | Best For | How It Works |
|----------|---------|--------------|
| `character` | Simple text | Split by character count |
| `token` | Token-aware splitting | Split by token count |
| `recursive` | Markdown, HTML | Tries separators in order: \n\n, \n, sentence, word |
| `markdown` | Markdown files | Splits on headers, preserves sections |
| `html` | Web pages | Splits on HTML tags, preserves structure |

## Embedding

This project uses custom embeddings via `src/rag/embeddings.ts`:

```typescript
import { createGoogleGenerativeAI } from "@ai-sdk/google"

const google = createGoogleGenerativeAI({ apiKey: process.env["GOOGLE_API_KEY"]! })
const embedder = google.textEmbeddingModel("gemini-embedding-001")

// Generate embedding
const { embedding } = await embedder.doEmbed({ values: [text] })
// Returns: number[] (768 dimensions for Gemini)
```

Mastra also provides built-in embedding via `embed()` function.

## Vector Stores

### pgvector (This Project)

```typescript
// Custom implementation in src/rag/retriever.ts
const result = await db.execute(sql`
  SELECT
    dc.id, dc.content, dc.document_id,
    d.title as document_title,
    d.source as document_source,
    1 - (dc.embedding <=> ${embeddingStr}::vector) as similarity_score
  FROM document_chunks dc
  JOIN documents d ON dc.document_id = d.id
  WHERE
    dc.embedding IS NOT NULL
    AND d.status = 'indexed'
    ${orgId ? sql`AND d.org_id = ${orgId}` : sql``}
    AND 1 - (dc.embedding <=> ${embeddingStr}::vector) >= ${threshold}
  ORDER BY dc.embedding <=> ${embeddingStr}::vector
  LIMIT ${topK}
`)
```

### Mastra's Vector Store Abstraction

```typescript
import { PgVector } from "@mastra/pg"

const vectorStore = new PgVector({
  connectionString: process.env["DATABASE_URL"]!,
})

// Query
const results = await vectorStore.query({
  indexName: "document_chunks",
  queryVector: embedding,
  topK: 10,
  filter: { orgId: "xxx" },  // MongoDB-style filter
})
```

### Metadata Filtering (MongoDB-style)

All Mastra vector stores support consistent filter syntax:

```typescript
// Equality
filter: { orgId: "hackstler" }

// Numeric comparison
filter: { score: { $gt: 0.5 } }

// Array membership
filter: { contentType: { $in: ["pdf", "youtube"] } }

// Logical operators
filter: { $or: [{ orgId: "a" }, { orgId: "b" }] }

// Combined
filter: {
  $and: [
    { orgId: "hackstler" },
    { contentType: { $in: ["youtube", "url"] } },
  ],
}
```

## Reranking

```typescript
import { rerank } from "@mastra/rag"

const reranked = await rerank(results, query, {
  weights: {
    semantic: 0.5,   // query understanding
    vector: 0.3,     // original similarity
    position: 0.2,   // result ordering
  },
  topK: 5,
})
```

### Available Scorers
- `MastraAgentRelevanceScorer` — built-in LLM-based scoring
- `CohereReranker` — Cohere's rerank API
- Custom scorers implementing the scorer interface

## GraphRAG

```typescript
import { GraphRAG } from "@mastra/rag"

const graphRag = new GraphRAG({
  dimension: 768,
  threshold: 0.7,
})

// Build graph from chunks
await graphRag.createIndex(chunks, embeddings)

// Query (traverses relationships)
const results = await graphRag.query({
  query: embedding,
  topK: 10,
  randomWalkSteps: 3,
  restartProb: 0.15,
})
```

GraphRAG discovers related content through graph traversal, finding connections that pure similarity search misses. Not implemented in this project but available if needed.

## Vector Query Tool

Mastra provides a tool that gives agents autonomous retrieval control:

```typescript
import { createVectorQueryTool } from "@mastra/rag"

const queryTool = createVectorQueryTool({
  vectorStoreName: "pgvector",
  indexName: "document_chunks",
  model: embedder,
})
```

This project uses a CUSTOM search tool (`searchDocuments`) instead, which provides more control over the retrieval pipeline (multi-query, reranking, org filtering).
