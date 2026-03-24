import { Hono } from "hono";
import { z } from "zod";
import { logger } from "../../shared/logger.js";
import type { AgentRunner } from "../../agent/agent-runner.js";
import type { AgentStep, AgentGenerateResult, DelegationResult } from "../../agent/types.js";
import { extractToolSummaries } from "../../agent/tool-summaries.js";
import type { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";
import type { ConversationManager } from "../../application/managers/conversation.manager.js";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";
import { createAgentContext } from "../../application/agent-context.js";
import { loadConversationHistory } from "../../agent/load-history.js";
import { extractSources } from "../helpers/extract-sources.js";
import { formatForWhatsApp, buildSourcesFooter } from "../helpers/format-whatsapp.js";
import { findPdfFilename } from "../helpers/find-pdf-filename.js";
import { findEmailDraft } from "../helpers/find-email-draft.js";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";

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
  attachmentStore: AttachmentStore,
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

      const experimental_context = createAgentContext({ userId, orgId, conversationId });
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

        logger.warn({ userId, attempt, maxAttempts: MAX_ATTEMPTS, stepsCount: result.steps.length, textLength: result.text.length }, "Empty agent response, retrying");
      }

      if (!replyText || !result) {
        logger.error({ userId }, "Agent returned empty response after all retries");
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
        logger.error({ err: persistError }, "Failed to persist messages");
      }

      const waText = formatForWhatsApp(replyText) + buildSourcesFooter(sources);

      // PDF retrieval: extract filename from tool results, retrieve from persistent store.
      // Only attach PDF to WhatsApp when the user's request was about GENERATING a quote,
      // not when they asked to send it by email (gmail handles the attachment itself).
      let document: DocumentAttachment | null = null;
      const delegatedToGmail = result.steps.some((s) =>
        s.toolResults.some((r) => r.toolName === "delegateTo_gmail"),
      );
      if (!delegatedToGmail) {
        const filename = findPdfFilename(result);
        if (filename) {
          const stored = await attachmentStore.retrieve(userId, filename);
          if (stored) {
            document = {
              base64: stored.base64,
              mimetype: stored.mimetype,
              filename: stored.filename,
            };
            logger.info({ filename: document.filename }, "PDF attached to WhatsApp reply");
          }
        }
      } else {
        logger.info("Skipping PDF attachment — email flow handled attachment via Gmail");
      }

      // Detect email draft — worker channel can't send buttons, but include draft info
      // so the worker knows not to treat the response as a final action.
      const emailDraft = findEmailDraft(result);

      return c.json({
        data: {
          reply: waText,
          ...(document && { document }),
          ...(emailDraft && { emailDraft }),
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Agent error processing WhatsApp message");
      return c.json({ error: "Agent unavailable" }, 503);
    }
  });

  return router;
}
