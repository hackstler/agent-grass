import { Hono } from "hono";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { AgentRunner } from "../../agent/agent-runner.js";
import type { AgentStep, AgentGenerateResult, DelegationResult } from "../../agent/types.js";
import { extractToolSummaries } from "../../agent/tool-summaries.js";
import type { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";
import type { ConversationManager } from "../../application/managers/conversation.manager.js";
import { createAgentContext } from "../../application/agent-context.js";
import { loadConversationHistory } from "../../agent/load-history.js";
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

const pairingCodeSchema = z.object({
  userId: z.string().uuid(),
  code: z.string().min(1),
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
 * When the coordinator delegates to a sub-agent, the sub-agent's tool results
 * are nested inside the delegation result. This flattens them for extractSources().
 */
function unwrapDelegationSteps(steps: AgentStep[]): AgentStep[] {
  const unwrapped: AgentStep[] = [];

  for (const step of steps) {
    const delegationResult = step.toolResults.find(
      (r) => r.toolName.startsWith("delegateTo_"),
    );

    if (delegationResult) {
      const nested = (delegationResult.result as DelegationResult | undefined)?.toolResults ?? [];
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
  agent: AgentRunner,
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

  router.post("/whatsapp/pairing-code", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = pairingCodeSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const result = await waManager.reportPairingCode(parsed.data.userId, parsed.data.code);
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
      const conversationId = await convManager.resolveOrCreateForChannel(
        `whatsapp:${chatId}`,
        userId,
        `WhatsApp: ${chatId}`,
      );

      const pdfRequestId = randomUUID();
      const experimental_context = createAgentContext({ userId, orgId, conversationId, pdfRequestId });
      const history = await loadConversationHistory(convManager, conversationId);

      let result: AgentGenerateResult | undefined;
      let replyText = "";
      const MAX_ATTEMPTS = 3;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        result = await agent.generate({
          prompt: messageBody,
          messages: history,
          experimental_context,
        });
        replyText = result.text?.trim() ?? "";

        if (replyText) break;

        console.warn(`[internal/message] empty response attempt ${attempt}/${MAX_ATTEMPTS}`, {
          userId,
          stepsCount: result.steps.length,
          textLength: result.text.length,
        });
      }

      if (!replyText || !result) {
        console.error("[internal/message] agent returned empty response after all retries", { userId });
        return c.json({
          data: { reply: "Lo siento, no pude procesar tu solicitud. Por favor, inténtalo de nuevo." },
        });
      }

      const steps = unwrapDelegationSteps(result.steps);
      const sources = extractSources(steps);
      const toolSummaries = extractToolSummaries(result.steps);

      // Persist messages separately — don't let a DB error kill the reply
      try {
        await convManager.persistMessages(conversationId, messageBody, replyText, {
          model: ragConfig.llmModel,
          retrievedChunks: sources.map((s) => s.id),
          toolCalls: toolSummaries,
        });
      } catch (persistError) {
        console.error("[internal/message] failed to persist messages:", persistError);
      }

      const waText = formatForWhatsApp(replyText) + buildSourcesFooter(sources);

      // PDF retrieval: keyed by pdfRequestId (UUID) via experimental_context.
      let document: DocumentAttachment | null = null;
      const storeEntry = pdfStore.take(pdfRequestId);
      if (storeEntry) {
        document = {
          base64: storeEntry.pdfBase64,
          mimetype: "application/pdf",
          filename: storeEntry.filename,
        };
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
