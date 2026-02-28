# Chunking Strategies Reference

## Strategy Comparison

| Strategy | Chunk Size Range | Best For | Tradeoffs |
|----------|-----------------|----------|-----------|
| **fixed** | 256–1024 | General purpose, uniform content | Simple, fast. May split semantic units mid-sentence. |
| **semantic** | 128–512 | Code, structured data | Better boundaries, slower processing. Needs embedding model. |
| **hierarchical** | 512–1024 | YouTube, long docs with sections | Preserves structure. More complex, may produce uneven chunks. |
| **recursive** | 256–512 | Markdown, HTML with headers | Respects document structure. Falls back to smaller separators. |

## This Project's Implementation

**Chunker**: `src/rag/chunker.ts`
**Config**: `src/config/rag.config.ts` — `chunkingStrategy: "fixed"`, `chunkSize: 512`, `chunkOverlap: 50`

**Content-type override** (`src/ingestion/processor.ts`):
```typescript
const chunkerOpts = loaded.metadata.contentType === "youtube"
  ? { strategy: "hierarchical", chunkSize: 512, chunkOverlap: 50 }
  : { strategy: ragConfig.chunkingStrategy, chunkSize: ragConfig.chunkSize, chunkOverlap: ragConfig.chunkOverlap }
```

## Chunk Size Impact

**Smaller chunks (128–256)**:
- More precise retrieval (less noise per chunk)
- More chunks per document (higher storage, more embeddings)
- Better for code, API docs, structured data
- Risk: losing context within chunks

**Larger chunks (512–1024)**:
- More context per chunk (better for complex topics)
- Fewer chunks (less storage, fewer embeddings)
- Better for narratives, transcripts, long-form content
- Risk: diluting relevance with irrelevant content

**Sweet spot for this project**: 512 tokens (default)
- YouTube transcripts: 512 with hierarchical (preserves sections)
- PDFs/text: 512 with fixed (uniform, predictable)
- If precision drops: try 256

## Overlap

**Why overlap**: Prevents losing context at chunk boundaries. A sentence split between two chunks is partially preserved in both.

**This project**: 50 tokens (10% of 512)
- Minimum recommended: 10% of chunk size
- For complex content: 20% (100 tokens with 512 chunk size)
- Too much overlap: duplicate content inflates storage and may cause redundant retrievals

## When to Change Strategy

| Symptom | Current Strategy | Try |
|---------|-----------------|-----|
| Chunks contain irrelevant padding | fixed | semantic or recursive |
| Section headers split from content | fixed | hierarchical |
| Code functions split mid-block | fixed/recursive | semantic with small size |
| YouTube sections lose context | fixed | hierarchical (already set) |
| Too many chunks, high storage | any | increase chunkSize |
| Low retrieval precision | large chunks | decrease chunkSize |

## Testing Changes

After changing chunking strategy:
1. Re-ingest affected documents: `POST /ingest { url: "..." }`
2. Run `/test-rag` with representative queries
3. Compare scores before/after
4. Check chunk count: `SELECT count(*) FROM document_chunks`
