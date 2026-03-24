import { Hono } from "hono";
import crypto from "crypto";
import { logger } from "../../shared/logger.js";
import type { AgentRunner } from "../../agent/agent-runner.js";
import type { ConversationManager } from "../../application/managers/conversation.manager.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import type { WhatsAppChannel } from "../../domain/ports/whatsapp-channel.js";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";
import { createAgentContext } from "../../application/agent-context.js";
import { loadConversationHistory } from "../../agent/load-history.js";
import { extractSources } from "../helpers/extract-sources.js";
import { extractToolSummaries } from "../../agent/tool-summaries.js";
import { findPdfFilename } from "../helpers/find-pdf-filename.js";
import { findEmailDraft } from "../helpers/find-email-draft.js";
import { takeDraft } from "../../plugins/gmail/services/draft-store.js";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";
import type { GmailApiService } from "../../plugins/gmail/services/gmail-api.service.js";

// Dedup: track processed idempotency keys to avoid duplicate responses
const processedKeys = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000;

function cleanupDedup() {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [key, ts] of processedKeys) {
    if (ts < cutoff) processedKeys.delete(key);
  }
}

export function createWebhookController(
  agent: AgentRunner,
  convManager: ConversationManager,
  orgRepo: OrganizationRepository,
  userRepo: UserRepository,
  whatsapp: WhatsAppChannel,
  attachmentStore: AttachmentStore,
  gmailService?: GmailApiService,
): Hono {
  const router = new Hono();
  const webhookSecret = process.env["KAPSO_WEBHOOK_SECRET"];

  router.post("/whatsapp", async (c) => {
    // 1. Parse body (verify signature if secret configured)
    let payload: Record<string, unknown>;
    if (webhookSecret) {
      const rawBody = await c.req.text();
      const signature = c.req.header("X-Webhook-Signature") ?? "";
      const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      if (signature && expected && signature.length === expected.length) {
        try {
          if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            return c.json({ error: "Invalid signature" }, 401);
          }
        } catch {
          return c.json({ error: "Invalid signature" }, 401);
        }
      }
      payload = JSON.parse(rawBody);
    } else {
      payload = await c.req.json();
    }

    // 2. Dedup
    const idempotencyKey = c.req.header("X-Idempotency-Key");
    if (idempotencyKey) {
      cleanupDedup();
      if (processedKeys.has(idempotencyKey)) {
        return c.json({ ok: true });
      }
      processedKeys.set(idempotencyKey, Date.now());
    }

    // 3. Parse Kapso v2 payload — data is an ARRAY when batch=true
    const rawData = payload["data"];
    const items: unknown[] = Array.isArray(rawData) ? rawData : rawData ? [rawData] : [];

    // 4. Process each message async (fire-and-forget)
    for (const item of items) {
      const entry = item as Record<string, unknown>;
      const message = entry["message"] as Record<string, unknown> | undefined;
      const conversation = entry["conversation"] as Record<string, unknown> | undefined;

      if (!message) continue;

      const messageId = message["id"] as string;
      const phoneNumberId = (entry["phone_number_id"] ?? conversation?.["phone_number_id"]) as string;
      const customerPhone = (message["from"] ?? conversation?.["phone_number"]) as string;

      if (!phoneNumberId || !customerPhone) continue;

      // Check for interactive button reply (HITL email confirmation)
      const interactive = message["interactive"] as Record<string, unknown> | undefined;
      const buttonReply = interactive?.["button_reply"] as Record<string, unknown> | undefined;
      if (buttonReply) {
        const buttonId = buttonReply["id"] as string;
        logger.info({ messageId, customerPhone, buttonId }, "Webhook button reply received");
        handleButtonReply(buttonId, phoneNumberId, customerPhone).catch((err) => {
          logger.error({ err, messageId }, "Webhook button reply error");
        });
        continue;
      }

      const textObj = message["text"] as Record<string, unknown> | undefined;
      const body = textObj?.["body"] as string | undefined;
      if (!body) continue;

      logger.info({ messageId, customerPhone, phoneNumberId, text: body.slice(0, 50) }, "Webhook processing message");

      // Fire and forget — respond 200 immediately, process in background
      processMessage(body, messageId, phoneNumberId, customerPhone).catch((err) => {
        logger.error({ err, messageId }, "Webhook async processing error");
      });
    }

    return c.json({ ok: true });
  });

  /**
   * Handle interactive button replies (email confirm/cancel).
   * Bypasses the agent entirely — deterministic HITL.
   */
  async function handleButtonReply(
    buttonId: string,
    phoneNumberId: string,
    customerPhone: string,
  ): Promise<void> {
    if (buttonId.startsWith("confirm_email:")) {
      const draftId = buttonId.replace("confirm_email:", "");
      const draft = takeDraft(draftId);
      if (!draft) {
        await whatsapp.sendText(phoneNumberId, customerPhone, "El borrador ha expirado. Pídeme que lo prepare de nuevo.");
        return;
      }

      if (!gmailService) {
        await whatsapp.sendText(phoneNumberId, customerPhone, "El servicio de email no está disponible.");
        return;
      }

      // Resolve user for attachment retrieval
      const user = await userRepo.findByPhone(customerPhone);
      if (!user) return;

      let attachment: { base64: string; mimetype: string; filename: string } | undefined;
      if (draft.attachmentFilename) {
        const stored = await attachmentStore.retrieve(user.id, draft.attachmentFilename);
        if (stored) attachment = stored;
      }

      try {
        await gmailService.sendEmail(user.id, draft.to, draft.subject, draft.body, attachment);
        await whatsapp.sendText(phoneNumberId, customerPhone, `Email enviado correctamente a ${draft.to}.`);
        logger.info({ draftId, to: draft.to }, "Email sent via WhatsApp button confirmation");
      } catch (err) {
        logger.error({ err, draftId }, "Failed to send email from WhatsApp button");
        await whatsapp.sendText(phoneNumberId, customerPhone, "No se pudo enviar el email. Inténtalo de nuevo.");
      }
      return;
    }

    if (buttonId.startsWith("cancel_email:")) {
      await whatsapp.sendText(phoneNumberId, customerPhone, "Email cancelado.");
      return;
    }

    logger.warn({ buttonId }, "Unknown button reply ID");
  }

  async function processMessage(
    messageText: string,
    messageId: string,
    phoneNumberId: string,
    customerPhone: string,
  ): Promise<void> {
    // Resolve user by their phone number
    const user = await userRepo.findByPhone(customerPhone);
    if (!user) {
      logger.warn({ customerPhone }, "No user found for phone");
      await whatsapp.sendText(phoneNumberId, customerPhone,
        "No tienes acceso a este servicio. Regístrate en la plataforma y añade tu número de teléfono.");
      return;
    }

    const userId = user.id;
    const orgId = user.orgId;

    // Send typing indicator + mark as read (fire-and-forget, before agent processing)
    whatsapp.sendTypingIndicator(phoneNumberId, messageId).catch(() => {});

    // Resolve conversation
    const conversationId = await convManager.resolveOrCreateForChannel(
      `kapso:${customerPhone}`,
      userId,
      `WhatsApp: ${customerPhone}`,
    );

    const experimental_context = createAgentContext({ userId, orgId, conversationId });
    const history = await loadConversationHistory(convManager, conversationId);

    // Run agent
    const result = await agent.generate({
      prompt: messageText,
      messages: history,
      experimental_context,
    });

    const replyText = result.text?.trim();
    if (!replyText) {
      logger.warn({ messageId }, "Empty agent response");
      return;
    }

    // Persist
    const sources = extractSources(result.steps);
    const toolSummaries = extractToolSummaries(result.steps);
    try {
      await convManager.persistMessages(conversationId, messageText, replyText, {
        model: ragConfig.llmModel,
        retrievedChunks: sources.map((s) => s.id),
        toolCalls: toolSummaries,
      });
    } catch (err) {
      logger.error({ err }, "Webhook message persist failed");
    }

    // Reply text
    await whatsapp.sendText(phoneNumberId, customerPhone, replyText);

    // Detect email draft in tool results → send interactive buttons for HITL confirmation
    const emailDraft = findEmailDraft(result);
    if (emailDraft) {
      const { draftId, preview } = emailDraft;
      const buttonBody = `📧 Para: ${preview.to}\n📋 Asunto: ${preview.subject}${preview.attachmentFilename ? `\n📎 Adjunto: ${preview.attachmentFilename}` : ""}`;
      await whatsapp.sendInteractiveButtons(phoneNumberId, customerPhone, buttonBody, [
        { id: `confirm_email:${draftId}`, title: "Enviar" },
        { id: `cancel_email:${draftId}`, title: "Cancelar" },
      ]);
      logger.info({ draftId }, "Email draft buttons sent via Kapso webhook");
    }

    // PDF: only if this specific request generated one AND the agent didn't
    // already send it via Gmail (avoids duplicate delivery).
    const delegatedToGmail = result.steps.some((s) =>
      s.toolResults.some((r) => r.toolName === "delegateTo_gmail"),
    );
    if (!delegatedToGmail) {
      const filename = findPdfFilename(result);
      if (filename) {
        const stored = await attachmentStore.retrieve(userId, filename);
        if (stored) {
          await whatsapp.sendDocument(phoneNumberId, customerPhone, {
            base64: stored.base64,
            mimetype: stored.mimetype,
            filename: stored.filename,
          });
          logger.info({ filename: stored.filename }, "PDF sent via Kapso webhook");
        }
      }
    }
  }

  return router;
}
