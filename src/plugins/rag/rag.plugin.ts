import { Hono } from "hono";
import type { Plugin } from "../plugin.interface.js";
import { ragAgent, ragTools } from "./rag.agent.js";
import { createChatRoutes } from "./routes/chat.routes.js";
import { createIngestRoutes } from "./routes/ingest.routes.js";

export class RagPlugin implements Plugin {
  readonly id = "rag";
  readonly name = "RAG Plugin";
  readonly description = "Retrieval-Augmented Generation with hybrid search, ingestion, and chat";
  readonly agent = ragAgent;
  readonly tools = ragTools;

  routes(): Hono {
    const app = new Hono();

    // Mount at exact same paths as before
    app.route("/chat", createChatRoutes(this.agent));
    app.route("/ingest", createIngestRoutes());

    return app;
  }
}
