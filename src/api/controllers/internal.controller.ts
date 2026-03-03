import { Hono } from "hono";
import { z } from "zod";
import type { Agent } from "@mastra/core/agent";
import type { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";
import type { ConversationManager } from "../../application/managers/conversation.manager.js";
import { extractSources } from "../helpers/extract-sources.js";
import { persistMessages } from "../helpers/persist-messages.js";
import { formatForWhatsApp, buildSourcesFooter } from "../helpers/format-whatsapp.js";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";

const qrSchema = z.object({
  qrData: z.string().min(1),
  userId: z.string().uuid(),
});

const statusSchema = z.object({
  status: z.enum(["connected", "disconnected"]),
  phone: z.string().optional(),
  userId: z.string().uuid(),
});

const messageSchema = z.object({
  messageId: z.string().min(1),
  body: z.string().min(1).max(10_000),
  chatId: z.string().min(1),
  userId: z.string().uuid(),
});

export interface DocumentAttachment {
  base64: string;
  mimetype: string;
  filename: string;
}

interface QuoteToolPayload {
  toolName: string;
  result?: {
    success?: boolean;
    pdfBase64?: string;
    filename?: string;
  };
}

/**
 * Extracts a PDF attachment from the agent's tool result steps.
 * Follows the same Mastra 1.5 pattern as extractSources().
 */
function extractPdfFromSteps(
  steps: Array<{ toolResults?: Array<unknown> }>
): DocumentAttachment | null {
  const allToolResults = steps.flatMap((s) => s.toolResults ?? []);

  const quoteResult = allToolResults.find((r) => {
    const payload = (r as { payload?: QuoteToolPayload }).payload;
    return payload?.toolName === "calculateBudget";
  });

  if (!quoteResult) return null;

  const payload = (quoteResult as { payload: QuoteToolPayload }).payload;
  const result = payload.result;

  if (!result?.success || !result.pdfBase64 || !result.filename) return null;

  return {
    base64: result.pdfBase64,
    mimetype: "application/pdf",
    filename: result.filename,
  };
}

export function createInternalController(
  waManager: WhatsAppManager,
  convManager: ConversationManager,
  agent: Agent,
): Hono {
  const router = new Hono();

  router.get("/whatsapp/sessions", async (c) => {
    const rows = await waManager.listActiveSessions();
    return c.json({ data: rows });
  });

  router.post("/whatsapp/qr", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = qrSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const result = await waManager.reportQr(parsed.data.userId, parsed.data.qrData);
    return c.json({ data: result });
  });

  router.post("/whatsapp/status", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const result = await waManager.reportStatus(
      parsed.data.userId,
      parsed.data.status,
      parsed.data.phone,
    );
    return c.json({ data: result });
  });

  router.post("/whatsapp/message", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = messageSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const { userId, body: messageBody, chatId } = parsed.data;

    const orgId = await waManager.resolveOrgId(userId);

    try {
      const conversationId = await convManager.resolveOrCreateByTitle(
        `whatsapp:${chatId}`,
        userId,
      );

      // Inject orgId as a hidden tag so the coordinator can pass it to tools.
      // NOTE: Mastra stores this enriched message in its memory (no way to strip it
      // before storage). The orgId leaks into conversation history — acceptable trade-off
      // since memory is already scoped by resource:orgId. persistMessages below uses
      // the clean messageBody for our own DB.
      const enrichedBody = `${messageBody}\n[org:${orgId}]`;

      const result = await agent.generate(enrichedBody, {
        memory: { thread: conversationId, resource: orgId },
      });

      const sources = extractSources(result.steps ?? []);
      const pdfAttachment = extractPdfFromSteps(result.steps ?? []);

      await persistMessages(conversationId, messageBody, result.text, {
        model: ragConfig.llmModel,
        retrievedChunks: sources.map((s) => s.id),
      });

      const waText = formatForWhatsApp(result.text) + buildSourcesFooter(sources);

      return c.json({
        data: {
          reply: waText,
          ...(pdfAttachment && { document: pdfAttachment }),
        },
      });
    } catch (error) {
      console.error("[internal/message] agent error:", error);
      return c.json({ error: "Agent unavailable" }, 503);
    }
  });

  return router;
}
