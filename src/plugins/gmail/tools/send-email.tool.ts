import { tool } from "ai";
import { z } from "zod";
import type { GmailApiService } from "../services/gmail-api.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { getOrCreateExecutionContext } from "../../../agent/execution-context.js";

export interface SendEmailDeps {
  gmailService: GmailApiService;
  attachmentStore: AttachmentStore;
}

export function createSendEmailTool({ gmailService, attachmentStore }: SendEmailDeps) {
  return tool({
    description:
      `Send an email via the user's Gmail account, optionally with a file attachment.
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

    // ── FRENO: tool-agnostic approval via ExecutionContext ───────────
    // The tool only reads/writes the shared context. It never inspects
    // message text or knows about confirmation flows — that's the
    // controller's job.
    needsApproval: async (input, { experimental_context }) => {
      const conversationId = getAgentContextValue({ experimental_context }, "conversationId");
      if (!conversationId) return false;

      const ctx = getOrCreateExecutionContext(conversationId);
      const actionId = `sendEmail:${input.to}:${input.subject}`;

      // Already confirmed by the controller on this turn → execute
      if (ctx.isConfirmed(actionId)) return false;

      // Register and block
      ctx.registerPending({
        id: actionId,
        toolName: "sendEmail",
        input: input as Record<string, unknown>,
        description: `Enviar email a ${input.to}\n• *Asunto:* ${input.subject}\n• *Cuerpo:* ${input.body}${input.attachmentFilename ? `\n• *Adjunto:* ${input.attachmentFilename}` : ""}`,
        createdAt: Date.now(),
      });

      return true;
    },

    execute: async ({ to, subject, body, attachmentFilename }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error("Missing userId in request context");

      let attachment: { base64: string; mimetype: string; filename: string } | undefined;

      if (attachmentFilename) {
        const stored = attachmentStore.retrieve(attachmentFilename);
        if (!stored) {
          throw new Error(`Attachment "${attachmentFilename}" not found. It may have expired or was never generated. Generate the document first, then try again.`);
        }
        attachment = stored;
      }

      const result = await gmailService.sendEmail(userId, to, subject, body, attachment);

      // Clean up confirmed flag after successful execution
      const conversationId = getAgentContextValue({ experimental_context }, "conversationId");
      if (conversationId) {
        const ctx = getOrCreateExecutionContext(conversationId);
        ctx.clearConfirmed();
      }

      return { ...result, attachmentIncluded: !!attachment };
    },
  });
}
