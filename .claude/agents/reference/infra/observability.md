# Observability Reference

## Structured Logging

### Rules
- **Never** `console.log` in worker — use `logger` from `src/shared/logger.ts`
- Backbone uses `console.log/error` but should migrate to structured logging
- Log levels: `debug` (dev only), `info` (normal operations), `warn` (recoverable), `error` (failures)
- Output: JSON to stdout (Railway captures automatically)

### Minimum Fields Per Log
```json
{
  "timestamp": "2026-02-28T10:30:00Z",
  "level": "info",
  "message": "Message processed",
  "orgId": "hackstler",
  "latencyMs": 150
}
```

### What to Log
- QR code generated (info)
- WhatsApp connection/disconnection (info)
- Message received — ID only, NOT content (info)
- RAG query — latency, chunks retrieved, model used (info)
- Response sent — latency (info)
- Errors — full stack trace in dev, message only in prod (error)
- Ingestion — document title, chunk count, strategy (info)

### What NOT to Log
- Message content (PII)
- Phone numbers
- API keys or secrets
- Full query text in production
- Embedding vectors

## Health Checks

### Backbone (`src/api/health.ts`)
```typescript
GET /health → {
  status: "healthy" | "unhealthy",
  db: boolean,        // can connect to PostgreSQL
  pgvector: boolean,  // vector extension available
  uptime: number,     // process uptime in seconds
}
```

Return `200` for healthy, `503` for unhealthy.
Railway pings this endpoint. If 503 → marks service unhealthy → may restart.

### Worker Health
No HTTP endpoint (headless). Health indicators:
- Heartbeat every 30s: reports status to backbone
- If backbone doesn't receive heartbeat > 60s: worker may be dead
- WhatsApp `ready` event = healthy
- WhatsApp `disconnected` event = needs attention

## Metrics to Track

### RAG Performance
| Metric | How to Measure | Target |
|--------|---------------|--------|
| Embedding latency | Time for `createEmbedding()` | < 200ms |
| Retrieval latency | Time for `retrieve()` | < 100ms |
| Total RAG latency | Query to response | < 3s |
| Chunks per query | From `extractSources()` | 3-10 |
| Similarity scores | From retriever results | > 0.5 avg |

### System Health
| Metric | How to Measure | Target |
|--------|---------------|--------|
| Response time | Middleware timer | < 500ms (non-RAG), < 5s (RAG) |
| Error rate | Count 5xx / total | < 1% |
| DB connections | `pg_stat_activity` | < 10 (pool max) |
| Memory usage | `process.memoryUsage()` | < 512MB |

### WhatsApp
| Metric | How to Measure | Target |
|--------|---------------|--------|
| Message processing time | Heartbeat + timestamps | < 10s |
| Connection uptime | Status reports to backbone | > 99% |
| QR scan to connected | Status change timestamps | < 30s |

## Mastra Observability

### Langfuse Integration
```typescript
// In rag.config.ts
enableTracing: Boolean(process.env["LANGFUSE_SECRET_KEY"]),
tracingProvider: "langfuse",

// Env vars
LANGFUSE_SECRET_KEY=sk-...
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

Langfuse traces: every agent call, tool usage, token consumption, latency per step.

### LangSmith Integration
```typescript
tracingProvider: "langsmith",

// Env vars
LANGSMITH_API_KEY=ls-...
```

### When to Add Tracing
- Production: when you need to debug specific user queries
- Cost optimization: to see token usage per query
- Quality monitoring: to track retrieval scores over time
- Currently: DISABLED (no tracing env vars set)

## Cost Monitoring

### Gemini API
- Embeddings: free tier covers most usage
- LLM (2.5-flash): check Google AI Studio dashboard
- If costs increase: reduce multi-query count (3 → 1), reduce topK

### Railway
- Check billing dashboard for compute usage
- Sleep mode on hobby: services sleep after inactivity
- If worker sleeps: WhatsApp disconnects → needs new QR scan

## Alerting Strategy

| Event | Severity | Action |
|-------|----------|--------|
| Health check fails | Critical | Railway auto-restarts |
| Repeated 503 on /internal/message | High | RAG overloaded, check Gemini API limits |
| Worker disconnected > 5min | Medium | May need manual QR re-scan |
| Migration fails at startup | Critical | Service crashes, check Railway logs |
| DB connection pool exhausted | High | Reduce max or investigate connection leaks |
| Embedding API rate limit | Medium | Reduce batch size in processor.ts |
