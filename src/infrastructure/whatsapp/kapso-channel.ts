import type { WhatsAppChannel, InteractiveButton } from "../../domain/ports/whatsapp-channel.js";
import { logger } from "../../shared/logger.js";

const KAPSO_BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

/**
 * Kapso implementation of WhatsAppChannel.
 *
 * Uses Kapso's REST API to send messages. No external SDK needed —
 * just fetch calls with the API key. When migrating to Meta direct,
 * create a MetaChannel that hits graph.facebook.com instead.
 */
export class KapsoChannel implements WhatsAppChannel {
  constructor(private readonly apiKey: string) {}

  async sendText(phoneNumberId: string, to: string, body: string): Promise<void> {
    const res = await fetch(`${KAPSO_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      logger.error({ statusCode: res.status, responseBody: err }, "sendText failed");
    }
  }

  async sendDocument(phoneNumberId: string, to: string, doc: {
    base64: string;
    filename: string;
    mimetype: string;
  }): Promise<void> {
    // Step 1: Upload media to Kapso
    const formData = new FormData();
    const buffer = Buffer.from(doc.base64, "base64");
    formData.append("file", new Blob([buffer], { type: doc.mimetype }), doc.filename);
    formData.append("messaging_product", "whatsapp");

    const uploadRes = await fetch(`${KAPSO_BASE}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { "X-API-Key": this.apiKey },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text().catch(() => "");
      logger.error({ statusCode: uploadRes.status, responseBody: err }, "media upload failed");
      return;
    }

    const { id: mediaId } = await uploadRes.json() as { id: string };

    // Step 2: Send document message with media ID
    const res = await fetch(`${KAPSO_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "document",
        document: { id: mediaId, filename: doc.filename },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      logger.error({ statusCode: res.status, responseBody: err }, "sendDocument failed");
    }
  }

  async sendInteractiveButtons(
    phoneNumberId: string,
    to: string,
    body: string,
    buttons: InteractiveButton[],
  ): Promise<void> {
    const res = await fetch(`${KAPSO_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: {
            buttons: buttons.map((btn) => ({
              type: "reply",
              reply: { id: btn.id, title: btn.title },
            })),
          },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      logger.error({ statusCode: res.status, responseBody: err }, "sendInteractiveButtons failed");
    }
  }

  async sendTypingIndicator(phoneNumberId: string, messageId: string): Promise<void> {
    try {
      const res = await fetch(`${KAPSO_BASE}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        logger.warn({ statusCode: res.status, responseBody: err }, "sendTypingIndicator failed (non-blocking)");
      }
    } catch (err) {
      // Fire-and-forget: never block the main message processing flow
      logger.warn({ err }, "sendTypingIndicator error (non-blocking)");
    }
  }
}
