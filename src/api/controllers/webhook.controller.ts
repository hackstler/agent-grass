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

export function createWebhookController(
  agent: AgentRunner,
  convManager: ConversationManager,
  orgRepo: OrganizationRepository,
  userRepo: UserRepository,
  whatsapp: WhatsAppChannel,
  attachmentStore: AttachmentStore,
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

      const textObj = message["text"] as Record<string, unknown> | undefined;
      const body = textObj?.["body"] as string | undefined;
      if (!body) continue;

      const messageId = message["id"] as string;
      const phoneNumberId = (entry["phone_number_id"] ?? conversation?.["phone_number_id"]) as string;
      const customerPhone = (message["from"] ?? conversation?.["phone_number"]) as string;

      if (!phoneNumberId || !customerPhone) continue;

      logger.info({ messageId, customerPhone, phoneNumberId, text: body.slice(0, 50) }, "Webhook processing message");

      // Fire and forget — respond 200 immediately, process in background
      processMessage(body, messageId, phoneNumberId, customerPhone).catch((err) => {
        logger.error({ err, messageId }, "Webhook async processing error");
      });
    }

    return c.json({ ok: true });
  });

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

    // Resolve conversation
    const conversationId = await convManager.resolveOrCreateForChannel(
      `kapso:${customerPhone}`,
      userId,
      `WhatsApp: ${customerPhone}`,
    );

    // Agent context + history
    const experimental_context = createAgentContext({
      userId,
      orgId,
      conversationId,
    });
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

    // Reply
    await whatsapp.sendText(phoneNumberId, customerPhone, replyText);

    // PDF if generated
    const pdf = attachmentStore.findLatestByPrefix("PRES-");
    if (pdf) {
      await whatsapp.sendDocument(phoneNumberId, customerPhone, pdf);
    }
  }

  return router;
}
