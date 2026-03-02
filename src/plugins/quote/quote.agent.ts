import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { quoteConfig } from "./config/quote.config.js";

export function createQuoteAgent(tools: ToolsInput): Agent {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for QuoteAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return new Agent({
    id: quoteConfig.agentName,
    name: quoteConfig.agentName,
    description: "Generates price quotes for artificial grass installation. Use when the user wants to calculate a budget or presupuesto for a client.",
    instructions: `You are a specialist in generating price quotes for artificial grass installation.
When given client information and product quantities, call calculateBudget to generate the quote.
Always confirm the details before generating if any required field is missing.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
