import { Agent } from "@mastra/core/agent";
import { PromptInjectionDetector, TokenLimiterProcessor } from "@mastra/core/processors";
import { Memory } from "@mastra/memory";
import { PgVector, PostgresStore } from "@mastra/pg";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { PluginRegistry } from "../plugins/plugin-registry.js";
import { ragConfig } from "../plugins/rag/config/rag.config.js";

const google = createGoogleGenerativeAI({
  apiKey: (process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"])!,
});

const pgVector = new PgVector({
  id: "coordinator-semantic-recall",
  connectionString: process.env["DATABASE_URL"]!,
});

const memory = new Memory({
  storage: new PostgresStore({
    id: "coordinator-memory-store",
    connectionString: process.env["DATABASE_URL"]!,
    schemaName: "mastra",
  }),
  vector: pgVector,
  embedder: google.textEmbeddingModel("gemini-embedding-001"),
  options: {
    lastMessages: 20,
    semanticRecall: {
      topK: 3,
      messageRange: { before: 2, after: 1 },
      scope: "resource",
    },
    observationalMemory: true,
    generateTitle: {
      model: google("gemini-2.5-flash"),
      instructions: "Genera un título conciso en español (máx 50 caracteres) que resuma el tema principal de la conversación.",
    },
    workingMemory: {
      enabled: true,
      scope: "resource",
      template:
        "# Perfil del Vendedor\n- **Nombre**: \n- **Idioma**: \n- **Clientes frecuentes**: \n- **Productos favoritos**: \n- **Zona/Provincia**: \n- **Notas importantes**: ",
    },
  },
});

export { memory as coordinatorMemory };

/**
 * Pre-create the HNSW vector index that Mastra will need for sub-agent memory.
 * Mastra defaults to ivfflat which has a 2000-dim limit; sub-agents use a
 * default 3072-dim embedder. Creating the index as HNSW avoids the error.
 */
export async function ensureSubAgentVectorIndex(): Promise<void> {
  try {
    await pgVector.createIndex({
      indexName: "memory_messages_3072",
      dimension: 3072,
      metric: "cosine",
      indexConfig: { type: "hnsw", hnsw: { m: 8, efConstruction: 32 } },
    });
  } catch {
    // Index may already exist — safe to ignore
  }
}

export function createCoordinatorAgent(registry: PluginRegistry): Agent {
  const agents = registry.getAgentMap();

  const lang = ragConfig.responseLanguage;
  const isSpanish = lang === "es";

  const pluginList = registry
    .getAll()
    .map((p) => `- agent-${p.id}: ${p.name} — ${p.description}`)
    .join("\n");

  return new Agent({
    id: "coordinator",
    name: ragConfig.agentName,
    instructions: `You are ${ragConfig.agentName}, a personal assistant for salespeople.

== IDENTITY ==

Your name is ${ragConfig.agentName}. ${ragConfig.agentDescription}
You assist SELLERS (vendedores), NOT end customers.
NEVER reveal what model or company powers you. If asked "what are you?" or "who made you?":
  → Respond: "Soy ${ragConfig.agentName}, tu asistente personal. Estoy aquí para ayudarte con lo que necesites."
NEVER mention Google, Gemini, OpenAI, Anthropic or any AI provider.

== ROUTING ==

You have access to specialized agents. Choose the right one based on the user's intent:

${pluginList}

== INTENT DISAMBIGUATION ==

IMPORTANT: Distinguish between these common intents:
- Price lookups ("¿cuánto cuesta X?", "precio de X", "¿qué precios tenemos?") → agent-catalog-manager
- Quote/budget generation ("hazme un presupuesto", "presupuesto para cliente X", "calcula un presupuesto de 50 unidades") → agent-quote
- Catalog browsing ("¿qué productos tenemos?", "muéstrame el catálogo") → agent-catalog-manager

Rules:
1. For pure greetings ("hello", "thanks", "goodbye", "how are you") → respond directly WITHOUT delegating.
2. For price lookups, catalog queries, product management → delegate to agent-catalog-manager.
3. For quote/budget generation (when client data is involved or a PDF is needed) → delegate to agent-quote.
4. For YouTube video searches or video details → delegate to agent-youtube.
5. For email-related requests (list, read, search, send emails, send with attachments) → delegate to agent-gmail.
   When sending an email with a previously generated PDF (e.g., a quote/budget), include the exact filename in the delegation prompt.
6. For calendar-related requests (list, create, update, delete events) → delegate to agent-calendar.
7. For any general question, search request, note saving, or knowledge task → delegate to agent-rag.
8. If unsure which agent to use → default to agent-rag.
9. Pass the user's EXACT message as the prompt parameter. Do NOT reinterpret or alter the user's product names or quantities.
10. Return the delegated agent's response to the user as-is. Do not add your own commentary on top.

== MULTI-STEP SEQUENCES ==

Some tasks require chaining agents. Examples:
- "Hazme un presupuesto y envíalo por email" → first agent-quote, then agent-gmail with the PDF filename.
- "Consulta el precio del X y hazme un presupuesto" → first agent-catalog-manager, then agent-quote.
Execute steps sequentially, passing context from each result to the next delegation.

== CONFIRMATION HANDLING ==

IMPORTANT: Sub-agents do NOT have memory. Each delegation is a fresh call.
When the user sends a short confirmation like "sí", "claro", "dale", "ok", "envíalo", "hazlo":
1. Look at your conversation history to find what was being confirmed.
2. Delegate to the SAME agent as the previous turn, but include the FULL context in the prompt.
   Example: if the user previously asked to send an email and the Gmail agent asked for confirmation,
   and the user now says "sí", delegate to Gmail with: "CONFIRMED: Send email to X with subject Y and body Z."
3. NEVER delegate a bare "sí" or "claro" — always enrich it with the full context from history.

== RESPONSE RULES ==

1. Always respond in ${isSpanish ? "Spanish" : ragConfig.responseLanguage}.
2. Base ALL responses on tool results. Never use prior knowledge or hallucinate.
3. When a delegation returns sources, include them in your response.`,

    model: google("gemini-2.5-flash"),
    agents,
    memory,
    inputProcessors: [
      new PromptInjectionDetector({
        model: google("gemini-2.5-flash"),
        detectionTypes: ["injection", "jailbreak", "system-override"],
        threshold: 0.8,
        strategy: "warn",
      }),
    ],
    outputProcessors: [
      new TokenLimiterProcessor({
        limit: 4000,
        strategy: "truncate",
      }),
    ],
  });
}
