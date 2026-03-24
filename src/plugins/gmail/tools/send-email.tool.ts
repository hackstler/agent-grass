import { tool } from "ai";
import { z } from "zod";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { saveDraft } from "../services/draft-store.js";

export interface SendEmailDeps {
  attachmentStore: AttachmentStore;
}

/**
 * Prepare an email draft for user confirmation.
 *
 * Validates inputs, resolves attachment, saves a draft, returns a preview.
 * The email is NEVER sent by the agent — the user confirms via the UI
 * (dashboard button or WhatsApp interactive button), which calls
 * POST /emails/confirm/:draftId.
 */
export function createSendEmailTool({ attachmentStore }: SendEmailDeps) {
  return tool({
    description:
      `Prepare an email draft for the user to review before sending.
This tool does NOT send the email — it creates a draft and returns a preview.
The user will confirm or cancel the email outside of this conversation (via a button in the UI).
You CANNOT send the email yourself — there is no tool for that.
To attach a previously generated document (e.g., a PDF quote), provide its filename
exactly as shown when it was generated (e.g., "PRES-20260306-1234.pdf").
Use listQuotes first to find the correct filename if the user refers to an old quote.`,
    inputSchema: z.object({
      to: z
        .string()
        .email()
        .describe("Recipient email address"),
      subject: z
        .string()
        .min(1)
        .describe("Email subject line"),
      body: z
        .string()
        .min(1)
        .describe("Plain text email body"),
      attachmentFilename: z
        .string()
        .optional()
        .describe("Filename of a previously generated document to attach (e.g., PRES-20260306-1234.pdf)"),
    }),
    execute: async ({ to, subject, body, attachmentFilename }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error("Missing userId in request context");

      // Validate attachment exists (fail early, before showing draft to user)
      if (attachmentFilename) {
        const stored = await attachmentStore.retrieve(userId, attachmentFilename);
        if (!stored) {
          return {
            success: false,
            error: "ATTACHMENT_NOT_FOUND",
            details: `Attachment "${attachmentFilename}" not found. The filename may be wrong.`,
            suggestion: "Use listQuotes to find the correct filename, then retry with the exact filename.",
            retryable: true,
          };
        }
      }

      // Save draft for later confirmation
      const draftId = saveDraft({ to, subject, body, attachmentFilename });

      return {
        success: true,
        draft: true,
        draftId,
        preview: {
          to,
          subject,
          body: body.length > 200 ? body.slice(0, 200) + "…" : body,
          attachmentFilename: attachmentFilename ?? null,
        },
        message: "Draft created. The user will see a confirmation button to send or cancel this email.",
      };
    },
  });
}
