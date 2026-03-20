import type { WhatsAppChannel } from "../../domain/ports/whatsapp-channel.js";

const KAPSO_BASE = "https://api.kapso.ai/v1";

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
    const res = await fetch(`${KAPSO_BASE}/whatsapp/phone-numbers/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        to,
        type: "text",
        text: { body },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[kapso] sendText failed:", res.status, err);
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

    const uploadRes = await fetch(`${KAPSO_BASE}/whatsapp/phone-numbers/${phoneNumberId}/media`, {
      method: "POST",
      headers: { "X-API-Key": this.apiKey },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text().catch(() => "");
      console.error("[kapso] media upload failed:", uploadRes.status, err);
      return;
    }

    const { id: mediaId } = await uploadRes.json() as { id: string };

    // Step 2: Send document message with media ID
    const res = await fetch(`${KAPSO_BASE}/whatsapp/phone-numbers/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        to,
        type: "document",
        document: { id: mediaId, filename: doc.filename },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error("[kapso] sendDocument failed:", res.status, err);
    }
  }
}
