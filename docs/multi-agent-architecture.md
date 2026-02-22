# Multi-Agent Architecture — Decision Guide

Última actualización: 2026-02
Basado en: Anthropic Engineering, Mastra 1.5 docs, OpenAI Agents SDK, Microsoft Research 2025.

---

## TL;DR

| Tools por cliente | Arquitectura | Estado |
|-------------------|--------------|--------|
| 1-6 | Un agente + tools flat | ✅ Óptimo — arquitectura actual |
| 7-9 (dominios distintos) | Orchestrator + specialist agents via `agents: {}` | Upgrade de ~3 ficheros |
| 10+ o flujo no-determinista | `agent.network()` routing | Refactor del endpoint |

**Regla de Anthropic, OpenAI y Mastra**: *"Push one agent to its limit first. Split only when toolset and branching logic become unwieldy."*

---

## Por qué el modelo plano aguanta hasta 6-8 tools

### Context rot y tool-space interference

Microsoft Research (2025, análisis de 1.470 MCP servers) encontró que la degradación de calidad empieza con **10+ tools**, no antes. Gemini 2.5 Flash (128K context) tiene más margen que modelos de 8K, pero el fenómeno aplica a todos.

Síntomas cuando llegas al límite:
- El agente elige la tool equivocada con más frecuencia
- Las descripciones de tools similares se "interfieren" entre sí
- El KV-cache se rompe si cambias el set de tools dinámicamente
- Loops más largos, más cost, más latencia

### Lo que dice Anthropic de su propio sistema

Su sistema de research interno usa Lead Agent (Opus) + Subagentes (Sonnet):
- **+90.2% de rendimiento** sobre un agente único
- Pero solo para *breadth-first queries* con múltiples workstreams independientes en paralelo
- Para RAG conversacional estándar: ese overhead no se justifica

### Distinción oficial tool call vs subagente (Anthropic docs)

| Usa tool call si... | Usa subagente si... |
|---------------------|---------------------|
| Acción estructurada y determinista (DB query, API call, retrieval) | Tareas genuinamente paralelizables |
| Resultado predecible con schema fijo | Cada subtarea necesita contexto aislado |
| Una sola responsabilidad | Workstreams independientes que no deben contaminar el razonamiento principal |

→ `searchDocuments` es correcto como tool. No como subagente.

---

## Las 3 arquitecturas en Mastra 1.5

### Fase 1 — Agente plano + tools (actual)

```typescript
// src/agent/rag-agent.ts
export const ragAgent = new Agent({
  id: "rag-agent",
  tools: createToolRegistry(deps),  // { searchDocuments, searchWeb, booking, ... }
  memory,
  instructions: "...",
});
```

**Cuándo usar:** 1-6 tools en un único dominio coherente.
**Límite práctico:** 8 tools, o cuando el agente empiece a confundir cuándo usar cada una.

---

### Fase 2 — Orchestrator + specialist agents via `agents: {}`

Mastra convierte automáticamente cada subagente en una tool llamada `agent-<key>`.
El subagente **debe tener `description`** o Mastra lanza error en init.

```typescript
// src/agent/knowledge-agent.ts
export const knowledgeAgent = new Agent({
  id: "knowledge-agent",
  name: "Knowledge Agent",
  description: "Searches and retrieves information from the knowledge base and the web. Use for any question that requires looking up information.",
  instructions: "You retrieve and synthesize information. Always cite your sources.",
  model: google("gemini-2.5-flash"),
  tools: createKnowledgeToolRegistry(deps),  // searchDocuments, searchWeb, searchDatabase
  memory,
});

// src/agent/action-agent.ts
export const actionAgent = new Agent({
  id: "action-agent",
  name: "Action Agent",
  description: "Executes transactional actions: creating bookings, sending notifications, updating records. Use when the user wants to DO something, not just know something.",
  instructions: "You execute actions. Always confirm before mutating data.",
  model: google("gemini-2.5-flash"),
  tools: createActionToolRegistry(deps),  // booking, email, updateRecord
  memory,
});

// src/agent/rag-agent.ts  (orchestrator)
export const ragAgent = new Agent({
  id: "rag-agent",
  name: ragConfig.agentName,
  instructions: `${baseInstructions}

    Delegate to the appropriate specialist:
    - For information lookup: use agent-knowledgeAgent
    - For transactional actions: use agent-actionAgent`,
  model: google("gemini-2.5-flash"),
  agents: {
    knowledgeAgent,   // becomes tool "agent-knowledgeAgent"
    actionAgent,      // becomes tool "agent-actionAgent"
  },
  // Note: direct tools here only if orchestrator needs them without delegation
  memory,
});
```

**Lo que cambia en tools/index.ts:**
```typescript
// Antes:
const ALL_TOOLS: ToolEntry[] = [searchDocumentsEntry, searchWebEntry, bookingEntry];

// Después (Fase 2):
export const KNOWLEDGE_TOOLS: ToolEntry[] = [searchDocumentsEntry, searchWebEntry, searchDatabaseEntry];
export const ACTION_TOOLS: ToolEntry[] = [bookingEntry, emailEntry, updateRecordEntry];
export const ALL_TOOLS: ToolEntry[] = [...KNOWLEDGE_TOOLS, ...ACTION_TOOLS]; // retrocompat
```

**Cuándo usar:** 7-9 tools con dos dominios semánticamente distintos (conocimiento vs. acción), o cuando las tool descriptions empiezan a confundirse entre sí.

---

### Fase 3 — Agent Network via `.network()`

```typescript
const stream = await ragAgent.network("Busca los tratamientos disponibles para piel seca y reserva el más económico");

for await (const chunk of stream) {
  if (chunk.type === "network-execution-event-step-finish") {
    console.log("Step:", chunk.payload.result);
  }
  if (chunk.type === "agent-execution-event-text-delta") {
    process.stdout.write(chunk.payload.text);
  }
}
```

**Advertencia de producción (Mastra Engineering):** `.network()` necesita un prompt extremadamente detallado para no saltarse pasos o ejecutarlos en el orden incorrecto. No es "plug and play".

**Cuándo usar:** 10+ tools, flujo de ejecución genuinamente no-determinista, o tareas que requieren planificación dinámica que un sistema de prompts no puede codificar.

**No usar para:** RAG conversacional estándar. El overhead de latencia y coste no se justifica.

---

### Deprecated — No usar

```typescript
// DEPRECATED en Mastra — no usar
import { AgentNetwork } from "@mastra/core/network";
```

---

## Señales de que es hora de migrar a Fase 2

| Síntoma | Significado |
|---------|-------------|
| El agente llama a `booking` cuando debería llamar a `searchDocuments` | Tool descriptions se superponen, demasiadas tools |
| Loops de re-planificación sin avanzar | Context rot: el contexto está lleno de tool schemas |
| Un cliente necesita >6 tools nuevas | Probablemente dos dominios distintos |
| Las preguntas "¿qué sabes?" y "haz X" fallan mezcladas | Knowledge y Action deberían estar separados |

---

## Lo que NO cambia al migrar a Fase 2

- Los archivos de tools individuales (`src/agent/tools/*.ts`) — no se tocan
- El patrón ToolEntry — sigue igual
- Las interfaces y adapters (`rag/interfaces.ts`, `rag/adapters.ts`) — sin cambios
- La API HTTP — el endpoint `/chat` sigue llamando a `ragAgent.generate()` / `.stream()`
- El `tools.config.ts` — sigue controlando qué tools están activas

---

## Coste de la migración (cuando sea necesaria)

**Ficheros nuevos:** `src/agent/knowledge-agent.ts`, `src/agent/action-agent.ts`
**Ficheros modificados:** `src/agent/tools/index.ts` (exportar KNOWLEDGE_TOOLS + ACTION_TOOLS), `src/agent/rag-agent.ts` (cambiar `tools:` por `agents:`)
**Ficheros sin cambios:** todo lo demás

Estimación real: **2-3 horas** incluyendo tests.

---

## Fuentes

- [Anthropic: Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic: How We Built Our Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Mastra: Agent Networks](https://mastra.ai/docs/agents/networks)
- [Mastra: Agent Class Reference](https://mastra.ai/reference/agents/agent)
- [Mastra: Supervisor Agent Example](https://mastra.ai/examples/agents/supervisor-agent)
- [Mastra: Beyond Workflows — vNext Agent Network](https://mastra.ai/blog/vnext-agent-network)
- [OpenAI: Orchestrating Multiple Agents — Agents SDK](https://openai.github.io/openai-agents-python/multi_agent/)
- [Microsoft Research: Tool-Space Interference in the MCP Era](https://www.microsoft.com/en-us/research/blog/tool-space-interference-in-the-mcp-era-designing-for-agent-compatibility-at-scale/)
- [Medium: How Many Tools Can an AI Agent Have?](https://achan2013.medium.com/how-many-tools-functions-can-an-ai-agent-has-21e0a82b7847)
