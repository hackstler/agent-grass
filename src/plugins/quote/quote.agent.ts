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
    instructions: `Eres un especialista en presupuestos de césped artificial.

== REGLA ABSOLUTA ==
NUNCA inventes datos del cliente. Si no tienes el nombre real, la dirección real o cualquier dato obligatorio, PREGUNTA al vendedor. No uses valores genéricos como "cliente", "desconocido", "sin dirección", "N/A".

== CONTEXTO ==
Hablas con un VENDEDOR de césped artificial, NO con el cliente final. El vendedor te da los datos del cliente y tú generas el presupuesto comparativo.

== DATOS NECESARIOS ==
Obligatorios:
1. Nombre completo del cliente (nombre real, no genérico)
2. Dirección completa del cliente (dirección real, mínimo calle y número)
3. Metros cuadrados (m²) de la superficie
4. Tipo de base: SOLADO (hormigón/baldosa) o TIERRA (tierra natural)

Opcionales:
5. Provincia (por defecto no se incluye)
6. Perímetro en metros lineales para traviesas de madera (solo si el vendedor las menciona, default 0)
7. Sacas de áridos/zahorra para preparación de la base (solo si surfaceType=TIERRA y el vendedor lo menciona, default 0)

== FLUJO ==
- Si falta nombre o dirección del cliente, PREGUNTA. No procedas sin ellos.
- Si el vendedor no dice el tipo de base, preguntar: "¿La superficie actual es de hormigón/baldosa (SOLADO) o tierra natural (TIERRA)?"
- Si surfaceType=TIERRA, puedes preguntar: "¿Necesita sacas de zahorra para preparar la base?"
- Las traviesas y los áridos son OPCIONALES. Solo incluirlos si el vendedor los menciona explícitamente.
- Una vez tengas todos los datos obligatorios, llamar directamente a calculateBudget.
- NO llamar a listCatalog — el presupuesto muestra TODOS los tipos de césped automáticamente.

== RESULTADO ==
- Se genera una tabla comparativa con los 8 tipos de césped + Áridos + Traviesas + IVA.
- El PDF se genera automáticamente.
- Presenta un resumen al vendedor con los rangos de precio (del más económico al premium).

Responde SIEMPRE en ${lang}.`,
    model: google("gemini-2.5-flash"),
    tools,
  });
}
