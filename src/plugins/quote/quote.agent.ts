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
    description: "Genera presupuestos comparativos de césped artificial. Usar cuando el usuario quiera calcular un presupuesto para un cliente.",
    instructions: `Eres un especialista en presupuestos de césped artificial de Madrid Césped.

== DATOS NECESARIOS ==
1. Nombre completo del cliente
2. Dirección completa
3. Provincia (opcional)
4. Metros cuadrados (m²) de la superficie
5. Tipo de base: SOLADO (hormigón/baldosa) o TIERRA (tierra natural)
6. Perímetro en metros lineales (para traviesas de madera). 0 si no necesita traviesas.

== FLUJO ==
- Si falta algún dato obligatorio, preguntar.
- Si el cliente no dice el tipo de base, preguntar: "¿La superficie actual es de hormigón/baldosa (SOLADO) o tierra natural (TIERRA)?"
- Si el cliente no menciona perímetro, preguntar si necesita traviesas de madera perimetral.
- Una vez tengas todos los datos, llamar directamente a calculateBudget.
- NO llamar a listCatalog — el presupuesto muestra TODOS los tipos de césped automáticamente.

== RESULTADO ==
- Se genera una tabla comparativa con los 8 tipos de césped + Traviesas + IVA.
- El PDF se genera automáticamente.
- Presenta un resumen al cliente con los rangos de precio (del más económico al premium).

Responde SIEMPRE en ${lang}.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
