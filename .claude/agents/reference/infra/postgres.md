# PostgreSQL + pgvector Reference

## Connection Pool

```typescript
// src/db/client.ts
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  max: 10,                      // max connections in pool
  idleTimeoutMillis: 30_000,    // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail fast if can't connect
})

export const db = drizzle(pool, { schema })
```

**Rules**:
- ONE pool per process (singleton). Never create pools per request.
- Railway PostgreSQL has connection limits (~20-50 depending on plan).
- With 2 services (backbone + worker): each gets max: 10 → total 20.
- If adding more services: reduce max per service.

## pgvector

### Installation
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```
Railway PostgreSQL includes pgvector. For local: use `pgvector/pgvector:pg16` Docker image.

### Column Definition
```sql
-- In schema (Drizzle)
embedding: vector("embedding", { dimensions: 768 })

-- In SQL
ALTER TABLE document_chunks ADD COLUMN embedding vector(768);
```

### Similarity Search
```sql
-- Cosine similarity (1 = identical, 0 = orthogonal)
SELECT 1 - (embedding <=> query_vector::vector) AS similarity
FROM document_chunks
WHERE 1 - (embedding <=> query_vector::vector) >= 0.3  -- threshold
ORDER BY embedding <=> query_vector::vector  -- ascending = most similar first
LIMIT 10;
```

Operators:
- `<=>` — cosine distance (use for normalized embeddings)
- `<->` — L2 distance (euclidean)
- `<#>` — inner product (negative, for max inner product search)

### Indexes

**IVFFlat** (current — approximate nearest neighbor):
```sql
CREATE INDEX document_chunks_embedding_idx
ON document_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);  -- sqrt(num_rows) is good starting point
```
- Fast to build
- Approximate (may miss some results)
- Good for < 100k rows
- Tuning: `SET ivfflat.probes = 10;` (default 1, higher = more accurate)

**HNSW** (for larger datasets):
```sql
CREATE INDEX document_chunks_embedding_idx
ON document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```
- Slower to build (hours for millions of rows)
- More accurate than IVFFlat
- Higher memory usage
- Good for > 100k rows
- Tuning: `SET hnsw.ef_search = 40;` (default 40)

**When to migrate IVFFlat → HNSW**:
- > 100k chunks AND retrieval accuracy matters
- Steps: drop old index, create HNSW index, verify queries still work

### Dimension Change

Changing embedding dimensions (e.g., 768 → 1536) requires:
```sql
-- 1. Drop the index
DROP INDEX document_chunks_embedding_idx;

-- 2. Drop and recreate the column
ALTER TABLE document_chunks DROP COLUMN embedding;
ALTER TABLE document_chunks ADD COLUMN embedding vector(1536);

-- 3. Recreate the index
CREATE INDEX document_chunks_embedding_idx
ON document_chunks USING ivfflat (embedding vector_cosine_ops);

-- 4. Re-embed ALL documents (application-level)
```

## Migrations

### Drizzle Migration System

**Generate** (from schema diff):
```bash
npx drizzle-kit generate  # creates SQL file from schema.ts changes
```

**Apply** (run SQL files):
```bash
npx drizzle-kit migrate   # applies pending migrations from _journal.json
```

**Push** (schema-diff, no SQL files):
```bash
npx drizzle-kit push      # directly applies schema.ts to DB, ignores migrations
```

### Programmatic Migrations (This Project)

```typescript
// src/db/client.ts
import { migrate } from "drizzle-orm/node-postgres/migrator"

export async function runMigrations() {
  const candidates = [
    resolve(process.cwd(), "dist", "db", "migrations"),  // Docker
    resolve(process.cwd(), "src", "db", "migrations"),    // Local dev
  ]
  const folder = candidates.find(p => existsSync(resolve(p, "meta", "_journal.json")))
  if (!folder) { console.warn("No migrations folder found"); return }
  await migrate(db, { migrationsFolder: folder })
}
```

Called from `main()` in `src/index.ts` at startup.

### Journal Format

```json
// src/db/migrations/meta/_journal.json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1772300000000, "tag": "0000_initial", "breakpoints": true }
  ]
}
```

Each entry maps to a `.sql` file: `0000_initial.sql`

### Idempotent Patterns

```sql
-- Tables
CREATE TABLE IF NOT EXISTS my_table (...);

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Constraints (no IF NOT EXISTS for constraints)
DO $$ BEGIN
  ALTER TABLE my_table ADD CONSTRAINT my_constraint UNIQUE (col);
EXCEPTION
  WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS my_idx ON my_table (col);
```

## Monitoring

```sql
-- Active connections
SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();

-- Long-running queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - query_start > interval '5 seconds';

-- Table sizes
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- Index usage
SELECT indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE schemaname = 'public';
```

## Backup

- Railway: automatic daily backups (check plan)
- Manual: `pg_dump $DATABASE_URL > backup.sql`
- Restore: `psql $DATABASE_URL < backup.sql`
