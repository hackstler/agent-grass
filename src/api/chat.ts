import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { ragAgent } from "../agent/index.js";
import { db } from "../db/client.js";
import { messages, conversations } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { ragConfig } from "../config/rag.config.js";

const chat = new Hono();

const chatSchema = z.object({
  query: z.string().min(1).max(10_000),
  conversationId: z.string().uuid().optional(),
  orgId: z.string().optional(),
  documentIds: z.array(z.string().uuid()).optional(),
});

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

  const { query, orgId } = parsed.data;
  const conversationId = await resolveConversationId(parsed.data.conversationId);

  // threadId / resourceId: Mastra 1.5 Memory API — accepted at runtime,
  // missing from the TS overloads when memory is present.
  const result = await ragAgent.generate(
    query,
    { threadId: conversationId, resourceId: orgId ?? "anonymous" } as Parameters<typeof ragAgent.generate>[1]
  );

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
 *
 * Event types:
 *   { type: "sources", chunks: [...] }
 *   { type: "text", text: "..." }
 *   { type: "done" }
 *   { type: "error", message: "..." }
 */
chat.get("/stream", async (c) => {
  const queryParam = c.req.query("query");
  const conversationIdParam = c.req.query("conversationId");
  const orgId = c.req.query("orgId");

  if (!queryParam?.trim()) {
    return c.json({ error: "Missing 'query' query parameter" }, 400);
  }

  const parsed = chatSchema.safeParse({
    query: queryParam,
    conversationId: conversationIdParam ?? undefined,
    orgId,
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
      // threadId / resourceId: Mastra 1.5 Memory API — accepted at runtime,
      // missing from the TS overloads when memory is present.
      const agentStream = await ragAgent.stream(
        parsed.data.query,
        { threadId: conversationId, resourceId: orgId ?? "anonymous" } as Parameters<typeof ragAgent.stream>[1]
      );

      for await (const chunk of agentStream.fullStream) {
        // Mastra 1.5 wraps all event data in payload
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

function extractSources(
  steps: Array<{ toolResults?: Array<unknown> }>
) {
  const allToolResults = steps.flatMap((s) => s.toolResults ?? []);

  // Mastra 1.5 wraps tool results in a payload object
  const searchResult = allToolResults.find((r) => {
    const payload = (r as { payload?: { toolName?: string } }).payload;
    return payload?.toolName === "searchDocuments";
  });
  if (!searchResult) return [];

  const res = (searchResult as { payload: { result?: unknown } }).payload.result as {
    chunks?: Array<{
      id: string;
      documentTitle: string;
      documentSource: string;
      score: number;
      content: string;
    }>;
  } | undefined;

  return (res?.chunks ?? []).map((c) => ({
    id: c.id,
    documentTitle: c.documentTitle,
    documentSource: c.documentSource,
    score: c.score,
    excerpt: c.content.slice(0, 200) + (c.content.length > 200 ? "…" : ""),
  }));
}

async function persistMessages(
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
  metadata: { model?: string; retrievedChunks?: string[] }
): Promise<void> {
  await db.insert(messages).values([
    { conversationId, role: "user", content: userMessage },
    { conversationId, role: "assistant", content: assistantMessage, metadata },
  ]);

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export default chat;
