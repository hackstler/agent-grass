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
    execute: async ({ to, subject, body, attachmentFilename }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error('Missing userId in request context');

      let attachment: { base64: string; mimetype: string; filename: string } | undefined;

      if (attachmentFilename) {
        const stored = attachmentStore.retrieve(attachmentFilename);
        if (!stored) {
          throw new Error(`Attachment "${attachmentFilename}" not found. It may have expired or was never generated. Generate the document first, then try again.`);
        }
        attachment = stored;
      } else {
        // Fallback: if the LLM didn't pass a filename, look for the latest
        // generated quote PDF. This makes attachment deterministic — it doesn't
        // depend on the LLM remembering to pass the filename across turns.
        const latestPdf = attachmentStore.findLatestByPrefix("PRES-");
        if (latestPdf) {
          attachment = latestPdf;
        }
      }

      const result = await gmailService.sendEmail(userId, to, subject, body, attachment);
      return { ...result, attachmentIncluded: !!attachment };
    },
  });
}
