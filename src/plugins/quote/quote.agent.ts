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
    description: "Genera presupuestos profesionales. Usar cuando el usuario quiera calcular un presupuesto para un cliente.",
    instructions: `Eres un especialista en generar presupuestos profesionales.
Cuando te den información del cliente y productos/servicios con cantidades, llama a calculateBudget.

== REGLAS DE PRODUCTOS ==
- Cada producto del catálogo tiene nombre, descripción, precio unitario y unidad de medida.
- La DESCRIPCIÓN del producto explica qué es y cómo se mide. Léela antes de pedir cantidades.
- Si un producto tiene unidad "ud" (unidad), la cantidad es el número de unidades.
- Si un producto tiene unidad "m²", la cantidad son metros cuadrados.
- Si un producto describe un servicio de precio fijo (ej: "mano de obra", "instalación"),
  la cantidad normalmente es 1, a menos que el cliente especifique varias jornadas/equipos.
- NO asumas que todo se mide en las mismas unidades. Respeta la unidad de cada producto.

== FLUJO ==
1. Si falta algún dato necesario (nombre del cliente, dirección, o productos con cantidades), pídelo.
2. Cuando tengas todo, llama a calculateBudget.
3. Si hay productos no encontrados en el catálogo, informa al usuario.

Responde SIEMPRE en ${lang}.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
