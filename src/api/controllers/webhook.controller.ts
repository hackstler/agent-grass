import { Hono } from "hono";
import crypto from "crypto";
import { logger } from "../../shared/logger.js";
import type { AgentRunner } from "../../agent/agent-runner.js";
import type { ConversationManager } from "../../application/managers/conversation.manager.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import type { WhatsAppChannel } from "../../domain/ports/whatsapp-channel.js";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";
import type { MediaAttachment } from "../../agent/types.js";
import { extractReceiptData, validateExtraction, formatExtractionForAgent } from "../../plugins/expenses/services/receipt-extractor.js";
import { createAgentContext } from "../../application/agent-context.js";
import { loadConversationHistory } from "../../agent/load-history.js";
import { loadMemoryContext } from "../../agent/load-memories.js";
import { extractSources } from "../helpers/extract-sources.js";
import { extractToolSummaries } from "../../agent/tool-summaries.js";
import { findPdfFilename } from "../helpers/find-pdf-filename.js";
import { findEmailDraft } from "../helpers/find-email-draft.js";
import { takeDraft } from "../../plugins/gmail/services/draft-store.js";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";
import type { GmailApiService } from "../../plugins/gmail/services/gmail-api.service.js";
import type { MemoryManager } from "../../application/managers/memory.manager.js";

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

/**
 * Download media from Kapso's WhatsApp API (two-step flow).
 *
 * Step 1: GET /{mediaId}?phone_number_id={phoneNumberId} → { url, download_url, mime_type }
 * Step 2: GET {download_url} → binary (token is in the URL, no auth headers needed)
 *
 * Kapso returns two download options:
 * - `download_url`: Kapso-hosted signed URL (4 min expiry, no auth headers needed)
 * - `url`: Meta CDN URL (5 min expiry, no auth headers needed)
 *
 * The phone_number_id query parameter is REQUIRED — without it Kapso returns
 * 404 "WhatsApp configuration not found".
 */
async function downloadKapsoMedia(
  phoneNumberId: string,
  mediaId: string,
  apiKey: string,
): Promise<Uint8Array | null> {
  try {
    // Step 1: Get media info (download URL)
    const infoUrl = `${KAPSO_BASE}/${mediaId}?phone_number_id=${phoneNumberId}`;
    logger.info({ infoUrl, mediaId, phoneNumberId }, "Kapso: fetching media info");

    const metaRes = await fetch(infoUrl, {
      headers: { "X-API-Key": apiKey },
    });

    if (!metaRes.ok) {
      const errBody = await metaRes.text().catch(() => "");
      logger.error({ mediaId, status: metaRes.status, url: infoUrl, body: errBody.slice(0, 300) }, "Kapso media info fetch failed");
      return null;
    }

    const meta = await metaRes.json() as Record<string, unknown>;
    logger.info({ mediaId, metaKeys: Object.keys(meta) }, "Kapso media info response");

    // Prefer download_url (Kapso-signed, no auth needed) over url (Meta CDN)
    const downloadUrl = (meta["download_url"] ?? meta["url"]) as string | undefined;
    if (!downloadUrl) {
      logger.error({ mediaId, meta: JSON.stringify(meta).slice(0, 500) }, "Kapso media info missing download URL");
      return null;
    }

    // Step 2: Download binary — signed URLs don't need auth headers
    logger.info({ mediaId, downloadUrl: downloadUrl.slice(0, 120) }, "Kapso: downloading binary");

    const binaryRes = await fetch(downloadUrl);
    if (!binaryRes.ok) {
      const errBody = await binaryRes.text().catch(() => "");
      logger.error({ mediaId, status: binaryRes.status, body: errBody.slice(0, 300) }, "Kapso media binary download failed");
      return null;
    }

    const buffer = await binaryRes.arrayBuffer();
    logger.info({ mediaId, bytes: buffer.byteLength }, "Kapso media binary downloaded");
    return new Uint8Array(buffer);
  } catch (err) {
    logger.error({ err, mediaId }, "downloadKapsoMedia exception");
    return null;
  }
}

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
  memoryManager?: MemoryManager,
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

      // --- Extract message content (text, image, or document) ---
      const msgType = message["type"] as string | undefined;
      const textObj = message["text"] as Record<string, unknown> | undefined;
      const imageObj = message["image"] as Record<string, unknown> | undefined;
      const documentObj = message["document"] as Record<string, unknown> | undefined;

      // Determine prompt text (caption for media, body for text)
      let body: string | undefined;
      let mediaInfo: { mediaId: string; mimeType: string; filename?: string } | undefined;

      if (msgType === "text" || textObj) {
        body = textObj?.["body"] as string | undefined;
        if (!body) continue;
      } else if (msgType === "image" || imageObj) {
        const img = imageObj ?? (message["image"] as Record<string, unknown>);
        logger.info({ imagePayload: JSON.stringify(img).slice(0, 500) }, "RAW image object from Kapso webhook");
        const mediaId = img?.["id"] as string | undefined;
        const mimeType = (img?.["mime_type"] as string | undefined) ?? "image/jpeg";
        const caption = img?.["caption"] as string | undefined;
        if (!mediaId) continue;
        body = caption || "[El usuario envió una imagen]";
        mediaInfo = { mediaId, mimeType };
      } else if (msgType === "document" || documentObj) {
        const doc = documentObj ?? (message["document"] as Record<string, unknown>);
        const mediaId = doc?.["id"] as string | undefined;
        const mimeType = (doc?.["mime_type"] as string | undefined) ?? "application/pdf";
        const caption = doc?.["caption"] as string | undefined;
        const filename = doc?.["filename"] as string | undefined;
        if (!mediaId) continue;
        body = caption || `[El usuario envió un documento${filename ? `: ${filename}` : ""}]`;
        mediaInfo = filename ? { mediaId, mimeType, filename } : { mediaId, mimeType };
      } else {
        // Unsupported message type (voice, sticker, location, etc.) — skip silently
        logger.debug({ msgType, messageId }, "Unsupported message type — skipping");
        continue;
      }

      logger.info(
        { messageId, customerPhone, phoneNumberId, msgType: msgType ?? "text", text: body.slice(0, 50) },
        "Webhook processing message",
      );

      // Fire and forget — respond 200 immediately, process in background
      processMessage(body, messageId, phoneNumberId, customerPhone, mediaInfo).catch((err) => {
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
        const confirmMsg = `Email enviado correctamente a ${draft.to}.`;
        await whatsapp.sendText(phoneNumberId, customerPhone, confirmMsg);
        logger.info({ draftId, to: draft.to }, "Email sent via WhatsApp button confirmation");

        // Persist button action in conversation history so the agent knows the email was sent
        const conversationId = await convManager.resolveOrCreateForChannel(
          `kapso:${customerPhone}`, user.id, `WhatsApp: ${customerPhone}`,
        );
        await convManager.persistMessages(conversationId, "[Confirmación: enviar email]", confirmMsg, {});
      } catch (err) {
        logger.error({ err, draftId }, "Failed to send email from WhatsApp button");
        await whatsapp.sendText(phoneNumberId, customerPhone, "No se pudo enviar el email. Inténtalo de nuevo.");
      }
      return;
    }

    if (buttonId.startsWith("cancel_email:")) {
      const cancelMsg = "Email cancelado.";
      await whatsapp.sendText(phoneNumberId, customerPhone, cancelMsg);

      // Persist cancellation so the agent knows the email was cancelled
      const user = await userRepo.findByPhone(customerPhone);
      if (user) {
        const conversationId = await convManager.resolveOrCreateForChannel(
          `kapso:${customerPhone}`, user.id, `WhatsApp: ${customerPhone}`,
        );
        await convManager.persistMessages(conversationId, "[Confirmación: cancelar email]", cancelMsg, {});
      }
      return;
    }

    logger.warn({ buttonId }, "Unknown button reply ID");
  }

  async function processMessage(
    messageText: string,
    messageId: string,
    phoneNumberId: string,
    customerPhone: string,
    mediaInfo?: { mediaId: string; mimeType: string; filename?: string },
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

    // Download media if present (image or document)
    let attachments: MediaAttachment[] | undefined;

    if (mediaInfo) {
      const kapsoApiKey = process.env["KAPSO_API_KEY"] ?? "";
      logger.info({ phoneNumberId, mediaId: mediaInfo.mediaId, mimeType: mediaInfo.mimeType, hasApiKey: !!kapsoApiKey }, "Attempting Kapso media download");
      const data = await downloadKapsoMedia(phoneNumberId, mediaInfo.mediaId, kapsoApiKey);
      if (data) {
        const attachment: MediaAttachment = { data, mimeType: mediaInfo.mimeType };
        if (mediaInfo.filename) attachment.filename = mediaInfo.filename;
        attachments = [attachment];
        logger.info(
          { mediaId: mediaInfo.mediaId, mimeType: mediaInfo.mimeType, bytes: data.length },
          "Media downloaded for multimodal processing",
        );
      } else {
        logger.error({ mediaId: mediaInfo.mediaId, phoneNumberId }, "Media download failed — processing text-only");
      }
    }

    // Resolve conversation
    const conversationId = await convManager.resolveOrCreateForChannel(
      `kapso:${customerPhone}`,
      userId,
      `WhatsApp: ${customerPhone}`,
    );

    const experimental_context = createAgentContext({ userId, orgId, conversationId });
    const memoryMessages = await loadMemoryContext(memoryManager, orgId);
    const history = await loadConversationHistory(convManager, conversationId);

    // ── Receipt extraction at the entry point (before agents) ──────────────
    // If extraction succeeds, the enriched text replaces the raw image — no need to
    // store pending media (which would cause the delegation fallback to re-extract).
    if (attachments?.length && attachments[0]!.mimeType.startsWith("image/")) {
      logger.info({ bytes: attachments[0]!.data.length, mimeType: attachments[0]!.mimeType }, "Attempting receipt extraction at webhook level");
      const extracted = await extractReceiptData(attachments[0]!);
      if (extracted) {
        const issues = validateExtraction(extracted);

        // Persist receipt image in attachments table for later Drive upload
        const ext = (attachments[0]!.mimeType.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
        const safeVendor = (extracted.vendor || "unknown").replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ-]/g, "_").slice(0, 30).toLowerCase();
        const receiptFilename = `receipt_${safeVendor}_${extracted.date || "nodate"}.${ext}`;
        try {
          await attachmentStore.store({
            orgId,
            userId,
            filename: receiptFilename,
            attachment: {
              base64: Buffer.from(attachments[0]!.data).toString("base64"),
              mimetype: attachments[0]!.mimeType,
              filename: receiptFilename,
            },
            docType: "receipt",
          });
          logger.info({ receiptFilename, userId }, "Receipt image saved to attachments table");
        } catch (err) {
          logger.error({ err, receiptFilename }, "Failed to save receipt image to attachments");
        }

        messageText = formatExtractionForAgent(extracted, issues, receiptFilename);
        logger.info({ vendor: extracted.vendor, amount: extracted.amount, receiptFilename }, "Receipt extracted at webhook — enriching query");
        attachments = undefined; // extraction succeeded — image data no longer needed
      } else {
        logger.warn("Receipt extraction returned null — forwarding image to agent as-is");
        // Keep attachments so the agent can try to process the image directly
      }
    }

    logger.info(
      {
        userId,
        orgId,
        conversationId,
        promptPreview: messageText.slice(0, 200),
        memoryMsgs: memoryMessages.length,
        historyMsgs: history.length,
        hasAttachments: !!attachments?.length,
      },
      "[webhook] About to call coordinator agent.generate()",
    );

    // Run agent (multimodal if attachments still present, text-only if extraction succeeded)
    const result = await agent.generate({
      prompt: messageText,
      messages: [...memoryMessages, ...history],
      experimental_context,
      ...(attachments ? { attachments } : {}),
    });

    let replyText = result.text?.trim();
    const pdfFilename = findPdfFilename(result);
    logger.info(
      {
        userId,
        replyLength: replyText?.length ?? 0,
        replyPreview: replyText?.slice(0, 200),
        stepCount: result.steps.length,
        toolsByStep: result.steps.map((s, i) => ({
          step: i,
          tools: s.toolResults.map((tr) => tr.toolName),
        })),
        pdfFilenameInResult: pdfFilename,
      },
      "[webhook] coordinator agent.generate() RETURNED",
    );

    if (!replyText) {
      logger.warn({ messageId }, "Empty agent response");
      return;
    }

    // ── Anti-hallucination guard ──────────────────────────────────────────────
    // Deterministic check: if the reply CLAIMS a quote/PDF was just generated,
    // a real tool result MUST exist (calculateBudget produces { pdfGenerated:true,
    // filename:"..." }). When the LLM affirms generation without a tool result,
    // it is hallucinating — replace the reply with a honest retry message
    // instead of lying to the user.
    //
    // IMPORTANT: Skip the guard when the delegation went to a non-quote agent
    // (e.g. gmail). The reply may legitimately reference a PDF filename
    // (e.g. "He enviado PRES-xxx.pdf por email") without having generated it
    // in this turn. Triggering the guard on those replies is a false positive
    // that breaks email sending.
    const HALLUCINATED_GENERATION = /(?:^|[\s,.])(?:he|hemos|se ha|se han|ya he|de acuerdo[, ]+he)\s+generad[oa]\b|nuevo\s+presupuesto\s+(?:para|de|generado)|presupuesto\s+(?:listo|completo|generado correctamente)|aqu[ií]\s+tienes\s+(?:el|tu)\s+presupuesto|PRES-\d{8}-\d{4}\.pdf/i;
    const usedNonQuoteAgent = result.steps.some((s) =>
      s.toolResults.some((r) => r.toolName.startsWith("delegateTo_") && r.toolName !== "delegateTo_quote"),
    );
    if (!pdfFilename && !usedNonQuoteAgent && HALLUCINATED_GENERATION.test(replyText)) {
      logger.warn(
        {
          userId,
          replyPreview: replyText.slice(0, 200),
          stepCount: result.steps.length,
          toolNamesByStep: result.steps.map((s) => s.toolResults.map((tr) => tr.toolName)),
        },
        "[webhook] HALLUCINATION DETECTED — reply claims PDF generation but no tool result exists",
      );
      replyText = "Lo siento, no he podido generar el presupuesto en este intento. Por favor, repíteme los datos del cliente y los detalles para volver a intentarlo.";
    }

    // Persist (the cleaned replyText, not the hallucination)
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
    // The agent's text reply already contains the full preview, so the button body
    // is just a short action prompt to avoid duplicating the preview.
    const emailDraft = findEmailDraft(result);
    if (emailDraft) {
      const { draftId } = emailDraft;
      await whatsapp.sendInteractiveButtons(phoneNumberId, customerPhone, "¿Enviar este email?", [
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
      logger.info(
        { filename, userId, hasFilename: !!filename },
        "[webhook] PDF detection phase",
      );
      if (filename) {
        const stored = await attachmentStore.retrieve(userId, filename);
        if (stored) {
          try {
            await whatsapp.sendDocument(phoneNumberId, customerPhone, {
              base64: stored.base64,
              mimetype: stored.mimetype,
              filename: stored.filename,
            });
            logger.info(
              { filename: stored.filename, pdfKB: Math.round(stored.base64.length / 1024) },
              "[webhook] PDF sent via Kapso",
            );
          } catch (err) {
            logger.error({ err, filename: stored.filename }, "[webhook] Failed to send PDF via Kapso");
          }
        } else {
          logger.warn(
            { filename, userId },
            "[webhook] PDF filename found in agent result but NOT in AttachmentStore — attachment lost",
          );
        }
      }
    } else {
      logger.info("[webhook] PDF skipped — Gmail delegation detected");
    }
  }

  return router;
}
