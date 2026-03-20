import { Hono } from "hono";
import crypto from "crypto";
import type { AgentRunner } from "../../agent/agent-runner.js";
import type { ConversationManager } from "../../application/managers/conversation.manager.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import type { WhatsAppChannel } from "../../domain/ports/whatsapp-channel.js";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";
import { createAgentContext } from "../../application/agent-context.js";
import { loadConversationHistory } from "../../agent/load-history.js";
import { extractSources } from "../helpers/extract-sources.js";
import { extractToolSummaries } from "../../agent/tool-summaries.js";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";

// Dedup: track processed idempotency keys to avoid duplicate responses
const processedKeys = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000;

function cleanupDedup() {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [key, ts] of processedKeys) {
    if (ts < cutoff) processedKeys.delete(key);
  }
}

/**
 * Webhook controller for Kapso WhatsApp integration.
 *
 * Receives Kapso v2 webhooks, verifies signature, extracts the message,
 * resolves the org, runs the agent, and responds via the WhatsAppChannel port.
 *
 * Responds HTTP 200 immediately — agent execution happens async (fire-and-forget)
 * to avoid Kapso's 10-second timeout.
 */
export function createWebhookController(
  agent: AgentRunner,
  convManager: ConversationManager,
  orgRepo: OrganizationRepository,
  whatsapp: WhatsAppChannel,
  attachmentStore: AttachmentStore,
): Hono {
  const router = new Hono();
  const webhookSecret = process.env["KAPSO_WEBHOOK_SECRET"];

  router.post("/whatsapp", async (c) => {
    // 1. Verify signature
    if (webhookSecret) {
      const signature = c.req.header("X-Webhook-Signature") ?? "";
      const rawBody = await c.req.text();
      const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return c.json({ error: "Invalid signature" }, 401);
      }
      // Re-parse body since we consumed it
      var payload = JSON.parse(rawBody);
    } else {
      var payload = await c.req.json();
    }

    // 2. Dedup by idempotency key
    const idempotencyKey = c.req.header("X-Idempotency-Key");
    if (idempotencyKey) {
      cleanupDedup();
      if (processedKeys.has(idempotencyKey)) {
        return c.json({ ok: true });
      }
      processedKeys.set(idempotencyKey, Date.now());
    }

    // 3. Parse Kapso v2 payload
    const data = payload?.data;
    const message = data?.message;
    const conversation = data?.conversation;

    if (!message || message.type !== "text" || !message.text?.body) {
      // Not a text message (could be image, status update, etc.) — ack and skip
      return c.json({ ok: true });
    }

    const messageText = message.text.body as string;
    const messageId = message.id as string;
    const phoneNumberId = (data.phone_number_id ?? conversation?.phone_number_id) as string;
    const customerPhone = conversation?.phone_number as string;

    if (!phoneNumberId || !customerPhone) {
      console.warn("[webhook] Missing phoneNumberId or customerPhone in payload");
      return c.json({ ok: true });
    }

    // 4. Respond 200 immediately — process async to avoid Kapso 10s timeout
    const asyncProcess = async () => {
      try {
        // 5. Resolve org by phoneNumberId
        const org = await orgRepo.findByWhatsappPhoneNumberId(phoneNumberId);
        if (!org) {
          console.warn("[webhook] No org found for phoneNumberId:", phoneNumberId);
          await whatsapp.sendText(phoneNumberId, customerPhone,
            "Este servicio no está configurado. Contacta al administrador.");
          return;
        }

        // 6. Find a userId for this org (first admin user)
        // For now we use orgId to resolve — the agent uses orgId, not userId for data access
        const userId = "whatsapp-customer";

        // 7. Resolve or create conversation for this customer
        const conversationId = await convManager.resolveOrCreateForChannel(
          `kapso:${customerPhone}`,
          userId,
          `WhatsApp: ${customerPhone}`,
        );

        // 8. Build agent context + load history
        const experimental_context = createAgentContext({
          userId,
          orgId: org.orgId,
          conversationId,
        });
        const history = await loadConversationHistory(convManager, conversationId);

        // 9. Run the agent
        const result = await agent.generate({
          prompt: messageText,
          messages: history,
          experimental_context,
        });

        const replyText = result.text?.trim();
        if (!replyText) {
          console.warn("[webhook] Agent returned empty response for:", messageId);
          return;
        }

        // 10. Persist messages
        const steps = result.steps;
        const sources = extractSources(steps);
        const toolSummaries = extractToolSummaries(steps);

        try {
          await convManager.persistMessages(conversationId, messageText, replyText, {
            model: ragConfig.llmModel,
            retrievedChunks: sources.map((s) => s.id),
            toolCalls: toolSummaries,
          });
        } catch (err) {
          console.error("[webhook] Failed to persist messages:", err);
        }

        // 11. Send reply via WhatsApp
        await whatsapp.sendText(phoneNumberId, customerPhone, replyText);

        // 12. Send PDF if generated
        const pdfAttachment = attachmentStore.findLatestByPrefix("PRES-");
        if (pdfAttachment) {
          await whatsapp.sendDocument(phoneNumberId, customerPhone, pdfAttachment);
        }

      } catch (error) {
        console.error("[webhook] Error processing message:", messageId, error);
      }
    };

    // Fire and forget — don't await
    asyncProcess();

    return c.json({ ok: true });
  });

  return router;
}
