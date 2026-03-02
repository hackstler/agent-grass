# Embedding Models Reference

## Available Models

| Model | Provider | Dimensions | Multilingual | Cost | Quality |
|-------|----------|-----------|-------------|------|---------|
| **gemini-embedding-001** | Google | 768 | Good | Free tier | Good |
| text-embedding-3-small | OpenAI | 1536 | Moderate | $0.02/1M tokens | High |
| text-embedding-3-large | OpenAI | 3072 | Good | $0.13/1M tokens | Highest |
| nomic-embed-text | Ollama (local) | 768 | Moderate | Free (local) | Decent |

## This Project's Setup

**Model**: `gemini-embedding-001` (768 dimensions)
**Config**: `src/config/rag.config.ts` — `embeddingModel: "gemini-embedding-001"`, `embeddingDimensions: 768`
**Implementation**: `src/rag/embeddings.ts` + `src/rag/adapters.ts`
**Schema**: `src/db/schema.ts` — `vector("embedding", { dimensions: EMBEDDING_DIM })`

```typescript
// EMBEDDING_DIM from env, defaults to 768
const EMBEDDING_DIM = Number(process.env["EMBEDDING_DIM"] ?? 768)
```

## Dimension Tradeoffs

**768 dimensions** (Gemini, nomic):
- Lower storage: ~3KB per chunk
- Faster similarity search
- Good enough for most use cases
- This project's current setup

**1536 dimensions** (OpenAI small):
- Higher storage: ~6KB per chunk
- Better semantic nuance
- Standard in OpenAI ecosystem

**3072 dimensions** (OpenAI large):
- Highest quality
- 12KB per chunk
- Only worth it for >100k chunks with high precision needs

## Switching Models

**WARNING**: Changing embedding model requires re-embedding ALL documents.

Steps:
1. Update `EMBEDDING_DIM` env var (e.g., from 768 to 1536)
2. Update embedder in `src/rag/adapters.ts`
3. Drop and recreate the vector column + index:
   ```sql
   ALTER TABLE document_chunks DROP COLUMN embedding;
   ALTER TABLE document_chunks ADD COLUMN embedding vector(1536);
   CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops);
   ```
4. Re-ingest ALL documents to generate new embeddings
5. Verify with `/test-rag`

**Why this is expensive**:
- Every chunk needs a new embedding API call
- Index must be rebuilt
- If you have 10k chunks: ~$0.20 with OpenAI small, free with Gemini
- Downtime while re-embedding

## Cross-Language Quality

For multi-language content (this project has Spanish, English, Korean, German YouTube videos):

- **Gemini**: Good multilingual support, trained on diverse data
- **OpenAI small**: Best for English, decent for European languages
- **nomic**: Moderate multilingual, biased toward English

The project's current choice (Gemini) is good for its multilingual content mix.

## Batch Embedding

This project embeds in batches of 20 (`src/ingestion/processor.ts`):
```typescript
const BATCH_SIZE = 20
for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
  const batch = chunks.slice(i, i + BATCH_SIZE)
  const embeddings = await Promise.all(batch.map(c => createEmbedding(c.content)))
}
```

Gemini's free tier has rate limits. If hitting limits: reduce batch size or add delay.
