# Reranking Reference

## What Reranking Solves

Initial vector search is approximate — it finds chunks with similar embeddings, but:
- Embedding similarity ≠ relevance (semantically similar ≠ answers the question)
- Top-10 results may include chunks that are "near" the query but don't actually help
- Word order, exact matches, and cross-attention patterns are lost in embeddings

Reranking re-scores the initial results with a more sophisticated model.

## This Project's Setup

**Status**: DISABLED (`enableReranking: false`)
**Implementation**: `src/rag/reranker.ts`
**Config**: `rerankTopK: 3` (when enabled, return top 3 after reranking)

## Reranking Approaches

### 1. Mastra Built-in Reranker

Weighted combination of multiple scoring signals:

```typescript
import { rerank } from "@mastra/rag"

const reranked = await rerank(results, query, {
  weights: {
    semantic: 0.5,   // LLM understanding of relevance
    vector: 0.3,     // original cosine similarity
    position: 0.2,   // preserve original ranking
  },
  topK: 5,
})
```

**Pros**: No external API, configurable weights
**Cons**: Quality depends on weight tuning

### 2. Cross-Encoder Reranking

Takes (query, document) pairs and produces a relevance score using a specialized model:

```
Query: "recetas saludables con pollo"
Doc A: "12 recetas de pollo light..." → score: 0.92
Doc B: "tortilla con huevo frito..." → score: 0.31
```

**Pros**: Most accurate — considers full query-document interaction
**Cons**: Slower (one model call per pair), requires external service or local model

### 3. Cohere Rerank API

```typescript
import { CohereReranker } from "@mastra/rag"

const reranker = new CohereReranker({ apiKey: process.env["COHERE_API_KEY"] })
```

**Pros**: High quality, easy to integrate
**Cons**: External API dependency, cost ($1/1k queries)

### 4. LLM-as-Judge

Use the LLM itself to score relevance:

```typescript
const scores = await Promise.all(
  chunks.map(chunk =>
    llm.generate(`Rate relevance 0-10: Query: "${query}" Document: "${chunk.content}"`)
  )
)
```

**Pros**: Best quality with advanced models
**Cons**: Expensive (one LLM call per chunk), slow

## When to Enable Reranking

**Enable when**:
- Users complain about irrelevant results in top responses
- Precision matters more than speed (customer support use case)
- High topK (>5) where initial ranking quality degrades
- Different content types compete (YouTube vs PDF vs URL)

**Leave disabled when**:
- Low latency required (WhatsApp responses — current use case)
- Small document base (<100 docs)
- Results are already good enough
- Cost is a concern

## Impact on This Project

**Without reranking** (current):
```
Query → embed → retrieve top-10 → pass ALL to LLM context
```
- Latency: ~200ms (embedding + retrieval)
- Quality: depends on vector similarity alone

**With reranking**:
```
Query → embed → retrieve top-10 → rerank → pass top-3 to LLM context
```
- Latency: ~400ms (adds reranking step)
- Quality: better top-3, less noise in LLM context
- Benefit: LLM sees 3 highly relevant chunks instead of 10 mixed-quality chunks

## Enabling in This Project

1. Set `enableReranking: true` in `rag.config.ts`
2. Optionally adjust `rerankTopK` (default: 3)
3. The pipeline in `retrieval-pipeline.ts` already handles the conditional:
   ```typescript
   if (ragConfig.enableReranking) {
     chunks = await reranker(chunks, query, { topK: ragConfig.rerankTopK })
   }
   ```
4. Test with `/test-rag` — compare scores before/after
