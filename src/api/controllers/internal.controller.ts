import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import type { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";
import type { ConversationManager } from "../../application/managers/conversation.manager.js";
import { extractSources } from "../helpers/extract-sources.js";
import { formatForWhatsApp, buildSourcesFooter } from "../helpers/format-whatsapp.js";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";
import { pdfStore } from "../../plugins/quote/services/pdf-store.js";

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

/**
 * Unwraps nested toolResults from delegation steps.
 *
 * When the coordinator delegates to a sub-agent, the delegation tool returns
 * { text, toolResults } inside a Mastra payload wrapper. This function extracts
 * the nested toolResults so that extractSources() can find them as if the
 * tools had been called directly.
 */
function unwrapDelegationSteps(
  steps: Array<{ toolResults?: Array<unknown> }>
): Array<{ toolResults?: Array<unknown> }> {
  const unwrapped: Array<{ toolResults?: Array<unknown> }> = [];

  for (const step of steps) {
    const allToolResults = step.toolResults ?? [];

    const delegationResult = allToolResults.find((r) => {
      const payload = (r as { payload?: { toolName?: string } }).payload;
      const name = payload?.toolName ?? "";
      return name.startsWith("delegate-to-") || name.startsWith("delegateTo_");
    });

    if (delegationResult) {
      const payload = (delegationResult as {
        payload: { result?: { toolResults?: Array<unknown> } };
      }).payload;
      const nested = payload.result?.toolResults ?? [];
      if (nested.length > 0) {
        unwrapped.push({ toolResults: nested });
      }
    } else {
      unwrapped.push(step);
    }
  }

  return unwrapped.length > 0 ? unwrapped : steps;
}

/**
 * Extracts a PDF attachment from the agent's tool result steps.
 * Searches for calculateBudget tool results in Mastra's payload wrapper.
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

      const pdfRequestId = randomUUID();
      const requestContext = new RequestContext([['userId', userId], ['orgId', orgId], ['pdfRequestId', pdfRequestId]]);

      const result = await agent.generate(messageBody, {
        requestContext,
        memory: { thread: conversationId, resource: orgId },
      });

      const replyText = result.text?.trim();
      if (!replyText) {
        console.error("[internal/message] agent returned empty response", {
          userId,
          steps: result.steps?.length ?? 0,
        });
        return c.json({
          data: { reply: "Lo siento, no pude procesar tu solicitud. Por favor, inténtalo de nuevo." },
        });
      }

      const steps = unwrapDelegationSteps(result.steps ?? []);
      const sources = extractSources(steps);

      // Persist messages separately — don't let a DB error kill the reply
      try {
        await convManager.persistMessages(conversationId, messageBody, replyText, {
          model: ragConfig.llmModel,
          retrievedChunks: sources.map((s) => s.id),
        });
      } catch (persistError) {
        console.error("[internal/message] failed to persist messages:", persistError);
      }

      const waText = formatForWhatsApp(replyText) + buildSourcesFooter(sources);

      // Extract PDF: try Mastra tool steps first, fall back to in-memory store
      let document: DocumentAttachment | null = extractPdfFromSteps(steps);

      if (!document) {
        const storeEntry = pdfStore.take(pdfRequestId);
        if (storeEntry) {
          document = {
            base64: storeEntry.pdfBase64,
            mimetype: "application/pdf",
            filename: storeEntry.filename,
          };
        }
      } else {
        // Clean up store entry if step extraction succeeded
        pdfStore.take(pdfRequestId);
      }

      if (document) {
        console.log("[internal/message] PDF attached:", document.filename);
      }

      return c.json({
        data: {
          reply: waText,
          ...(document && { document }),
        },
      });
    } catch (error) {
      console.error("[internal/message] agent error:", error);
      return c.json({ error: "Agent unavailable" }, 503);
    }
  });

  return router;
}
