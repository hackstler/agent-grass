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
  /**
   * Send a typing indicator ("writing...") and mark the inbound message as read.
   * The indicator lasts up to 25 seconds or until a message is sent — whichever comes first.
   * Fire-and-forget: failures should be logged but never block the main flow.
   */
  sendTypingIndicator(phoneNumberId: string, messageId: string): Promise<void>;
}
