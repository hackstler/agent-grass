import { tool } from "ai";
import { z } from "zod";
import type { GmailApiService } from "../services/gmail-api.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface SendEmailDeps {
  gmailService: GmailApiService;
  attachmentStore: AttachmentStore;
}

export function createSendEmailTool({ gmailService, attachmentStore }: SendEmailDeps) {
  return tool({
    description:
      `Send an email via the user's Gmail account, optionally with a file attachment.
WARNING: This tool SENDS the email immediately — it does NOT ask for confirmation.
The calling agent MUST present a summary and get user confirmation BEFORE calling this tool.
Requires the user's Google account to be connected.
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
      if (!userId) throw new Error('Missing userId in request context');

      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) throw new Error('Missing orgId in request context');

      let attachment: { base64: string; mimetype: string; filename: string } | undefined;

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
        attachment = stored;
      }

      const result = await gmailService.sendEmail(userId, to, subject, body, attachment);
      return { ...result, attachmentIncluded: !!attachment };
    },
  });
}
