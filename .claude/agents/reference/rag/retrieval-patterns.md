# Retrieval Patterns Reference

## 1. Basic Semantic Search

**How**: Single query → embed → cosine similarity → top-K results

```typescript
// src/rag/retriever.ts
const result = await db.execute(sql`
  SELECT dc.id, dc.content, d.title, d.source,
    1 - (dc.embedding <=> ${embeddingStr}::vector) as similarity_score
  FROM document_chunks dc
  JOIN documents d ON dc.document_id = d.id
  WHERE d.status = 'indexed'
    AND 1 - (dc.embedding <=> ${embeddingStr}::vector) >= ${threshold}
  ORDER BY dc.embedding <=> ${embeddingStr}::vector
  LIMIT ${topK}
`)
```

**Pros**: Simple, fast, one embedding call
**Cons**: Single query perspective may miss relevant docs phrased differently
**When**: Quick lookups, small document bases, latency-critical paths

## 2. Multi-Query Retrieval (THIS PROJECT)

**How**: Original query → N reformulated queries → embed each → merge + dedup by chunk ID → keep highest score

```typescript
// src/rag/retriever.ts — retrieveMultiQuery()
const allResults = await Promise.all(
  queryEmbeddings.map(emb => retrieve(emb, { ...options, topK: options.topK * 2 }))
)
// Dedup: seen.get(chunk.id) keeps highest score
```

**Config**: `queryEnhancement: "multi-query"`, `multiQueryCount: 3`
**Cost**: 3× embedding calls (one per variant)
**Pros**: Better recall — finds docs that match different phrasings
**Cons**: 3× embedding cost, slightly higher latency (~100ms extra)
**When**: Default for this project. Good balance of recall vs speed.

## 3. HyDE (Hypothetical Document Embeddings)

**How**: Generate a hypothetical answer → embed THAT → search (the hypothetical answer is closer to real documents than the question)

**Config**: `queryEnhancement: "hyde"` (available but not default)
**Cost**: 1 LLM call + 1 embedding call
**Pros**: Bridges query-document semantic gap
**Cons**: Extra LLM call, hypothetical may hallucinate (embedding noise)
**When**: Questions are very different from document language (e.g., question in informal language, docs in formal)

## 4. Step-Back Prompting

**How**: Generate a broader/abstract version of the query → search with both original and abstract

**Config**: `queryEnhancement: "step-back"` (available, used in knowledge-base preset)
**Cost**: 1 LLM call + 2 embedding calls
**Pros**: Better for complex questions requiring abstraction
**Cons**: May be too broad, losing specificity
**When**: Knowledge-base use case, complex multi-part questions

## 5. Hybrid Search (Vector + Keyword)

**How**: Combine vector similarity with keyword matching (BM25) + metadata filtering

**Mastra's metadata filtering** (MongoDB-style):
```typescript
filter: {
  orgId: "hackstler",
  contentType: { $in: ["pdf", "youtube"] },
}
```

**This project**: Uses orgId filtering but not full hybrid search. The retriever filters by `d.org_id = ${orgId}` in SQL.

**When to add**: When vector search misses exact keyword matches (e.g., product names, codes, IDs that embeddings don't capture well)

## 6. GraphRAG

**How**: Build knowledge graph from chunks → traverse relationships → discover connected content

**Available in Mastra** but NOT implemented in this project:
```typescript
const graphRag = new GraphRAG({ dimension: 768, threshold: 0.7 })
```

**When**: Complex domains with interconnected concepts, when "related" content matters more than "similar" content
**Cost**: Graph construction overhead, more complex infrastructure

## pgvector-Specific Tuning

**IVFFlat probes** (current index type):
```sql
SET ivfflat.probes = 10;  -- default: 1. Higher = more accurate, slower
```
- Default probes=1: fast but may miss results
- Probes=10: good balance for <100k rows
- Set at connection level or per-query

**HNSW ef_search** (if migrated):
```sql
SET hnsw.ef_search = 40;  -- default: 40. Higher = more accurate
```

## Choosing a Strategy

```
Simple question, small DB       → Basic semantic search
General-purpose (DEFAULT)       → Multi-query (3 variants)
Complex questions, formal docs  → HyDE
Broad conceptual questions      → Step-back
Exact term matching needed      → Add keyword/hybrid
Connected knowledge domains     → GraphRAG
```

This project defaults to multi-query because:
- YouTube content has varied phrasing
- Multilingual content benefits from multiple query angles
- 3× embedding cost is acceptable (Gemini is free/cheap)
