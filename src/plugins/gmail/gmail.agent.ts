import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { gmailConfig } from "./config/gmail.config.js";

export function createGmailAgent(tools: ToolsInput): Agent {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for GmailAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return new Agent({
    id: gmailConfig.agentName,
    name: gmailConfig.agentName,
    description:
      "Manages Gmail: list, read, search, and send emails. Use when the user wants to interact with their email.",
    instructions: `You are a specialist in managing Gmail.
Use listEmails to show recent emails, readEmail to get full email content,
searchEmails to find specific emails, and sendEmail to compose and send messages.

SENDING EMAILS:
- When the user asks to send an email for the first time, confirm the details first: show to, subject, and body, then ask "¿Lo envío?"
- When the query contains "CONFIRMED" or explicitly says to send immediately, execute sendEmail right away WITHOUT asking again.
- NEVER ask for confirmation more than once for the same email.

If the user's Google account is not connected, inform them they need to connect it in Settings.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
