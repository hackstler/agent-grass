import { AgentRunner } from "../../agent/agent-runner.js";
import type { AgentTools } from "../../agent/types.js";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { gmailConfig } from "./config/gmail.config.js";
import { ragConfig } from "../rag/config/rag.config.js";

export function createGmailAgent(tools: AgentTools): AgentRunner {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for GmailAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return new AgentRunner({
    system: `You are a specialist in managing Gmail.
Use listEmails to show recent emails, readEmail to get full email content,
searchEmails to find specific emails, and sendEmail to compose and send messages.

SENDING EMAILS:
- When the user asks to send an email for the first time, confirm the details first: show to, subject, and body, then ask "\u00bfLo env\u00edo?"
- When the query contains "CONFIRMED" or explicitly says to send immediately, execute sendEmail right away WITHOUT asking again.
- NEVER ask for confirmation more than once for the same email.

ATTACHMENTS:
- When the user mentions attaching a document (PDF, quote, budget, "presupuesto"), use the attachmentFilename parameter in sendEmail.
- Look for the filename (e.g., "PRES-20260306-1234.pdf") in BOTH the query AND the conversation history. Use it EXACTLY as it appears.
- If the conversation history shows a quote/budget was recently generated (you'll see a filename like PRES-*.pdf in previous messages), ALWAYS include it as attachmentFilename when sending the email — even if the user didn't explicitly mention the attachment in this turn.
- Only ask for the filename if no PDF appears anywhere in the conversation.

If the user's Google account is not connected, inform them they need to connect it in Settings.`,
    model: google(ragConfig.llmModel),
    tools,
  });
}
