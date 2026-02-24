import { Hono } from "hono";
import { checkDbConnection, db } from "../db/client.js";
import { sql } from "drizzle-orm";
import { ragConfig } from "../config/rag.config.js";

const health = new Hono();

health.get("/", async (c) => {
  const dbOk = await checkDbConnection();

  const status = dbOk ? "ok" : "degraded";
  const httpStatus = dbOk ? 200 : 503;

  return c.json(
    {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? "ok" : "error",
      },
      version: "0.1.0",
    },
    httpStatus
  );
});

/**
 * GET /health/rag-debug?q=cenar
 * Diagnoses retrieval issues: shows DB contents, active config, and raw scores.
 * Protected by the same X-API-Key as the rest if API_KEY is set.
 */
health.get("/rag-debug", async (c) => {
  const query = c.req.query("q") ?? "que puedo cenar";

  // 1. DB summary
  const docsResult = await db.execute(sql`
    SELECT d.org_id, d.status, COUNT(d.id) as doc_count, COUNT(dc.id) as chunk_count
    FROM documents d
    LEFT JOIN document_chunks dc ON dc.document_id = d.id
    GROUP BY d.org_id, d.status
    ORDER BY doc_count DESC
  `);

  // 2. Active config values (what Railway env vars might be overriding)
  const activeConfig = {
    similarityThreshold: ragConfig.similarityThreshold,
    topK: ragConfig.topK,
    queryEnhancement: ragConfig.queryEnhancement,
    llmModel: ragConfig.llmModel,
    embeddingModel: ragConfig.embeddingModel,
    env_RAG_SIMILARITY_THRESHOLD: process.env["RAG_SIMILARITY_THRESHOLD"] ?? "(not set)",
    env_RAG_TOP_K: process.env["RAG_TOP_K"] ?? "(not set)",
    env_RAG_QUERY_ENHANCEMENT: process.env["RAG_QUERY_ENHANCEMENT"] ?? "(not set)",
  };

  // 3. Raw retrieval with threshold=0 to see actual scores
  let rawChunks: Array<{ id: string; title: string; org_id: string | null; score: number; excerpt: string }> = [];
  try {
    const { defaultEmbedder } = await import("../rag/adapters.js");
    const embedding = await defaultEmbedder.embed(query);
    const embStr = `[${embedding.join(",")}]`;

    const rawResult = await db.execute(sql`
      SELECT
        dc.id,
        d.title,
        d.org_id,
        1 - (dc.embedding <=> ${embStr}::vector) as score,
        LEFT(dc.content, 150) as excerpt
      FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE dc.embedding IS NOT NULL AND d.status = 'indexed'
      ORDER BY dc.embedding <=> ${embStr}::vector
      LIMIT 10
    `);

    rawChunks = (rawResult.rows as Array<{
      id: string; title: string; org_id: string | null; score: string; excerpt: string;
    }>).map((r) => ({
      id: r.id,
      title: r.title,
      org_id: r.org_id,
      score: Number(r.score),
      excerpt: r.excerpt,
    }));
  } catch (err) {
    rawChunks = [{ id: "error", title: "Embedding failed", org_id: null, score: 0, excerpt: String(err) }];
  }

  return c.json({
    query,
    activeConfig,
    dbSummary: docsResult.rows,
    topChunksWithThreshold0: rawChunks,
    diagnosis: rawChunks.length === 0
      ? "NO CHUNKS IN DB — nothing indexed yet"
      : (rawChunks[0]!.score < ragConfig.similarityThreshold
        ? `THRESHOLD TOO HIGH — best score ${rawChunks[0]!.score.toFixed(3)} < threshold ${ragConfig.similarityThreshold}`
        : `OK — top score ${rawChunks[0]!.score.toFixed(3)} passes threshold ${ragConfig.similarityThreshold}`),
  });
});

export default health;
