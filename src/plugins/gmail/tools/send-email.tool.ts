import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GmailApiService } from "../services/gmail-api.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface SendEmailDeps {
  gmailService: GmailApiService;
  attachmentStore: AttachmentStore;
}

export function createSendEmailTool({ gmailService, attachmentStore }: SendEmailDeps) {
  return createTool({
    id: "sendEmail",
    description:
      `Send an email via the user's Gmail account, optionally with a file attachment.
Confirm details with the user before sending unless the query contains CONFIRMED.
Requires the user's Google account to be connected.
To attach a previously generated document (e.g., a PDF quote), provide its filename
exactly as shown when it was generated (e.g., "PRES-20260306-1234.pdf").`,
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
    outputSchema: z.object({
      success: z.boolean(),
      messageId: z.string(),
      threadId: z.string(),
      attachmentIncluded: z.boolean(),
    }),
    execute: async ({ to, subject, body, attachmentFilename }, context) => {
      const userId = getAgentContextValue(context, "userId");
      if (!userId) throw new Error('Missing userId in request context');

      let attachment: { base64: string; mimetype: string; filename: string } | undefined;

      if (attachmentFilename) {
        const stored = attachmentStore.retrieve(attachmentFilename);
        if (!stored) {
          throw new Error(`Attachment "${attachmentFilename}" not found. It may have expired or was never generated. Generate the document first, then try again.`);
        }
        attachment = stored;
      }

      const result = await gmailService.sendEmail(userId, to, subject, body, attachment);
      return { ...result, attachmentIncluded: !!attachment };
    },
  });
}
