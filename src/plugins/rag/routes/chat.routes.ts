import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Agent } from "@mastra/core/agent";
import { ragConfig } from "../config/rag.config.js";
import { db } from "../../../infrastructure/db/client.js";
import { conversations } from "../../../infrastructure/db/schema.js";
import { extractSources } from "../../../api/helpers/extract-sources.js";
import { persistMessages } from "../../../api/helpers/persist-messages.js";

const chatSchema = z.object({
  query: z.string().min(1).max(10_000),
  conversationId: z.string().uuid().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
});

/**
 * Factory: creates chat routes bound to a specific RAG agent instance.
 */
export function createChatRoutes(agent: Agent): Hono {
  const chat = new Hono();

  /**
   * POST /chat
   * Non-streaming: agent decides which tools to call, returns complete answer.
   */
  chat.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = chatSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const { query } = parsed.data;
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "Missing orgId" }, 401);
    const conversationId = await resolveConversationId(parsed.data.conversationId);

    const result = await agent.generate(query, {
      memory: { thread: conversationId, resource: orgId },
    });

    const sources = extractSources(result.steps ?? []);

    await persistMessages(conversationId, query, result.text, {
      model: ragConfig.llmModel,
      retrievedChunks: sources.map((s) => s.id),
    });

    return c.json({
      conversationId,
      answer: result.text,
      sources,
      metadata: {
        model: ragConfig.llmModel,
        chunksRetrieved: sources.length,
      },
    });
  });

  /**
   * GET /chat/stream?query=...&conversationId=...
   * SSE streaming. Emits: sources → text chunks → done
   */
  chat.get("/stream", async (c) => {
    const queryParam = c.req.query("query");
    const conversationIdParam = c.req.query("conversationId");
    const orgId = c.get("user")?.orgId;

    if (!orgId) return c.json({ error: "Unauthorized", message: "Missing orgId" }, 401);

    if (!queryParam?.trim()) {
      return c.json({ error: "Missing 'query' query parameter" }, 400);
    }

    const parsed = chatSchema.safeParse({
      query: queryParam,
      conversationId: conversationIdParam ?? undefined,
    });

    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    const conversationId = await resolveConversationId(parsed.data.conversationId);

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Conversation-Id", conversationId);

    return stream(c, async (streamWriter) => {
      let fullAnswer = "";
      let sourcesEmitted = false;
      const collectedSources: Array<{ id: string; documentTitle: string; documentSource: string; score: number; excerpt: string }> = [];

      try {
        const agentStream = await agent.stream(parsed.data.query, {
          memory: { thread: conversationId, resource: orgId },
        });

        for await (const chunk of agentStream.fullStream) {
          const payload = (chunk as { payload?: Record<string, unknown> }).payload ?? {};

          if (chunk.type === "tool-result") {
            const toolName = payload["toolName"] as string | undefined;
            if (toolName === "searchDocuments" && !sourcesEmitted) {
              const res = payload["result"] as {
                chunks?: Array<{ id: string; content: string; documentTitle: string; documentSource: string; score: number }>;
              } | undefined;
              const chunks = res?.chunks ?? [];
              collectedSources.push(
                ...chunks.map((ch) => ({
                  id: ch.id,
                  documentTitle: ch.documentTitle,
                  documentSource: ch.documentSource ?? "",
                  score: ch.score,
                  excerpt: ch.content?.slice(0, 200) + (ch.content?.length > 200 ? "…" : ""),
                }))
              );
              await streamWriter.write(
                `data: ${JSON.stringify({ type: "sources", chunks: collectedSources })}\n\n`
              );
              sourcesEmitted = true;
            }
          } else if (chunk.type === "text-delta") {
            const text = (payload["text"] as string | undefined) ?? "";
            if (text) {
              fullAnswer += text;
              await streamWriter.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
            }
          }
        }

        if (!sourcesEmitted) {
          await streamWriter.write(
            `data: ${JSON.stringify({ type: "sources", chunks: [] })}\n\n`
          );
        }

        if (fullAnswer) {
          await persistMessages(conversationId, parsed.data.query, fullAnswer, {
            model: ragConfig.llmModel,
            retrievedChunks: collectedSources.map((s) => s.id),
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Internal error";
        await streamWriter.write(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`);
      } finally {
        await streamWriter.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      }
    });
  });

  return chat;
}

// ============================================================
// Helpers
// ============================================================

async function resolveConversationId(id?: string): Promise<string> {
  if (id) {
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, id),
      columns: { id: true },
    });
    if (conv) return id;
  }

  const [conv] = await db
    .insert(conversations)
    .values({ title: "New conversation" })
    .returning({ id: conversations.id });

  return conv!.id;
}
