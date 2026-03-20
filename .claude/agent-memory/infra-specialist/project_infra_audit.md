---
name: Infrastructure audit findings (March 2026)
description: Full infrastructure review — Docker, Railway, DB, deps, security, monitoring
type: project
---

Full infra audit completed 2026-03-19. Key findings saved below.

**Why:** Baseline review before next production iteration.
**How to apply:** Use as reference when tackling any infra task; findings marked CRITICAL need action first.

## Critical
- No SIGTERM/SIGINT handlers in index.ts — Railway sends SIGTERM, pool connections leak on restart
- `prestart` script runs `drizzle-kit push --force` — ignored in Docker (CMD node, not npm start), but dangerous if ever used locally against prod DB
- IVFFlat created without `WITH (lists = N)` — defaults to 1 list, degrades to full scan
- `pdfBase64` stored as TEXT in `quotes` table — large blobs in DB row, increases vacuum load and query time

## Important
- `@anthropic-ai/sdk` and `openai` packages in prod dependencies but only used in embeddings.ts as optional fallback — bloat in the Docker image
- `xlsx` package in prod deps but no usage found in src/ — dead dependency
- `langfuse` in prod deps but only referenced in rag.config.ts for tracing provider detection — should be optional/dev
- Missing DB indexes on `quotes.org_id` and `quotes.user_id` for listing queries
- No graceful shutdown (pool.end()) — connections held until Railway SIGKILL (10s)
- JWT token TTL is 7 days, no rotation mechanism documented

## Migration numbering chaos
- Journal entries idx 6/7 use tags 0010/0011 (invitations, user name)
- Then idx 8/9 reuse tags 0008/0009 (baseline_sync, pairing_code) — two migrations with the same numeric prefix
- The hardcoded DELETE from __drizzle_migrations for timestamp 1772905955669 is a workaround for a prior bad migration, not cleaned up
