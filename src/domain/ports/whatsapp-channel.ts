/**
 * Port for outbound WhatsApp messaging.
 *
 * The webhook controller uses this to respond to customers after the agent
 * generates a reply. Implementations can be Kapso, Meta direct, or any BSP.
 */

export interface WhatsAppChannel {
  sendText(phoneNumberId: string, to: string, body: string): Promise<void>;
  sendDocument(phoneNumberId: string, to: string, doc: {
    base64: string;
    filename: string;
    mimetype: string;
  }): Promise<void>;
}
