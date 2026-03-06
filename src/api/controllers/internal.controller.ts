import { Hono } from "hono";
import { z } from "zod";
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
 * Regex to find quote PDF filenames in agent text responses.
 * Matches: PRES-YYYYMMDD-XXXX.pdf
 */
const QUOTE_FILENAME_RE = /PRES-\d{8}-\d{1,6}\.pdf/;

/**
 * Unwraps nested toolResults from delegation steps.
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

      const requestContext = new RequestContext([['userId', userId], ['orgId', orgId]]);

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

      // Deterministic PDF retrieval: extract filename from agent text, look up in store.
      // The calculateBudget tool always stores the PDF keyed by filename (e.g. PRES-20260306-1234.pdf).
      // The agent always includes the filename in its text response.
      // This approach has ZERO dependency on Mastra's RequestContext or step propagation.
      let document: DocumentAttachment | null = null;
      const filenameMatch = replyText.match(QUOTE_FILENAME_RE);
      if (filenameMatch) {
        const storeEntry = pdfStore.take(filenameMatch[0]);
        if (storeEntry) {
          document = {
            base64: storeEntry.pdfBase64,
            mimetype: "application/pdf",
            filename: storeEntry.filename,
          };
        } else {
          console.warn("[internal/message] PDF filename found in text but not in store:", filenameMatch[0]);
        }
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
