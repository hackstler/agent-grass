import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { ensurePgVector } from "./db/client.js";
import { authMiddleware } from "./api/middleware/auth.js";
import health from "./api/health.js";
import authRouter from "./api/auth.js";
import ingest from "./api/ingest.js";
import chat from "./api/chat.js";
import conversationsRouter from "./api/conversations.js";
import topicsRouter from "./api/topics.js";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", secureHeaders());
app.use(
  "*",
  cors({
    origin: process.env["ALLOWED_ORIGINS"]?.split(",") ?? "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  })
);

// Routes
app.route("/health", health);                          // public — no auth
app.route("/auth", authRouter);                        // public — register/login/me

const auth = authMiddleware();
app.use("/ingest/*", auth);
app.use("/chat/*", auth);
app.use("/conversations/*", auth);
app.use("/topics/*", auth);

app.route("/ingest", ingest);
app.route("/chat", chat);
app.route("/conversations", conversationsRouter);
app.route("/topics", topicsRouter);

// 404 handler
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("[error]", err);
  return c.json(
    { error: "Internal server error", message: err.message },
    500
  );
});

// Startup
const PORT = Number(process.env["PORT"] ?? 3000);

async function main() {
  // Validate required API keys before starting
  const googleKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!googleKey) {
    throw new Error(
      "Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY — required for embeddings and LLM"
    );
  }

  // Ensure pgvector extension is installed
  await ensurePgVector();
  console.log("[startup] pgvector extension ready");

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[startup] rag-agent-backbone running on http://localhost:${PORT}`);
    console.log(`[startup] Environment: ${process.env["NODE_ENV"] ?? "development"}`);
  });
}

main().catch((err) => {
  console.error("[fatal] Failed to start server:", err);
  process.exit(1);
});

export default app;
