import { Agent } from "@mastra/core/agent";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { quoteConfig } from "./config/quote.config.js";
import { calculateBudgetTool } from "./tools/calculate-budget.tool.js";

const google = createGoogleGenerativeAI({
  apiKey: (process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"])!,
});

export const quoteAgent = new Agent({
  id: quoteConfig.agentName,
  name: quoteConfig.agentName,
  description: "Generates price quotes for artificial grass installation. Use when the user wants to calculate a budget or presupuesto for a client.",
  instructions: `You are a specialist in generating price quotes for artificial grass installation.
When given client information and product quantities, call calculateBudget to generate the quote.
Always confirm the details before generating if any required field is missing.`,
  model: google("gemini-2.5-flash"),
  tools: { calculateBudget: calculateBudgetTool },
});

export const quoteTools = { calculateBudget: calculateBudgetTool };
