import { Hono } from "hono";
import { logger } from "../../shared/logger.js";
import { takeDraft } from "../../plugins/gmail/services/draft-store.js";
import type { GmailApiService } from "../../plugins/gmail/services/gmail-api.service.js";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";

/**
 * Email confirmation endpoint.
 *
 * Called by the dashboard (button click) or WhatsApp controller (button reply)
 * to actually send a previously drafted email. The agent CANNOT call this —
 * it's a deterministic human-in-the-loop gate.
 */
export function createEmailController(
  gmailService: GmailApiService,
  attachmentStore: AttachmentStore,
): Hono {
  const router = new Hono();

  /**
   * POST /emails/confirm/:draftId
   *
   * Auth: user JWT (mounted behind authMiddleware in app.ts)
   * Takes a draft, resolves attachment, sends via Gmail.
   */
  router.post("/confirm/:draftId", async (c) => {
    const { draftId } = c.req.param();
    const user = c.get("user");
    const userId = user?.userId;

    if (!userId) {
      return c.json({ error: "Unauthorized", message: "Missing userId" }, 401);
    }

    const draft = takeDraft(draftId);
    if (!draft) {
      return c.json(
        { error: "NotFound", message: `Draft "${draftId}" not found or expired (10 min TTL).` },
        404,
      );
    }

    // Resolve attachment if any
    let attachment: { base64: string; mimetype: string; filename: string } | undefined;
    if (draft.attachmentFilename) {
      const stored = await attachmentStore.retrieve(userId, draft.attachmentFilename);
      if (!stored) {
        return c.json(
          { error: "NotFound", message: `Attachment "${draft.attachmentFilename}" is no longer available.` },
          404,
        );
      }
      attachment = stored;
    }

    try {
      const result = await gmailService.sendEmail(userId, draft.to, draft.subject, draft.body, attachment);
      logger.info({ draftId, messageId: result.messageId, to: draft.to }, "Email sent via draft confirmation");
      return c.json({ data: { success: true, messageId: result.messageId } });
    } catch (err) {
      logger.error({ err, draftId }, "Failed to send email from draft");
      const message = err instanceof Error ? err.message : "Failed to send email";
      return c.json({ error: "InternalError", message }, 500);
    }
  });

  return router;
}
