import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { quoteConfig } from "./config/quote.config.js";
import { ragConfig } from "../../plugins/rag/config/rag.config.js";

export function createQuoteAgent(tools: ToolsInput): Agent {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY for QuoteAgent");
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const lang = ragConfig.responseLanguage === "es" ? "español" : ragConfig.responseLanguage;

  return new Agent({
    id: quoteConfig.agentName,
    name: quoteConfig.agentName,
    description: "Genera presupuestos de instalación de césped artificial. Usar cuando el usuario quiera calcular un presupuesto para un cliente.",
    instructions: `Eres un especialista en generar presupuestos de instalación de césped artificial.
Cuando te den información del cliente y cantidades de productos, llama a calculateBudget para generar el presupuesto.
Si falta algún dato necesario (nombre del cliente, dirección, o productos con cantidades), pídelo antes de generar.
Responde SIEMPRE en ${lang}.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
