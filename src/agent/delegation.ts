import { tool } from "ai";
import { z } from "zod";
import type { AgentTools, DelegationResult } from "./types.js";
import type { Plugin } from "../plugins/plugin.interface.js";
import { getAgentContextValue } from "../application/agent-context.js";
import { loadConversationHistory } from "./load-history.js";
import type { ConversationManager } from "../application/managers/conversation.manager.js";
import { ragConfig } from "../plugins/rag/config/rag.config.js";

/**
 * Creates a single delegation tool that wraps a plugin's agent.
 * The coordinator calls this tool to delegate work to the plugin's specialized agent.
 *
 * Conversation history is loaded from the DB and passed to the sub-agent so it can
 * understand context from previous turns (names, topics, references).
 *
 * Returns a DelegationResult — the shared contract consumed by
 * chat.routes.ts (streaming SSE) and internal.controller.ts (WhatsApp).
 */
function createDelegationTool(plugin: Plugin, convManager: ConversationManager) {
  return tool({
    description: `Delegate to ${plugin.name}: ${plugin.description}`,
    inputSchema: z.object({
      query: z.string().describe("The user query or instruction to delegate"),
    }),
    execute: async ({ query }, { experimental_context }): Promise<DelegationResult> => {
      try {
        const conversationId = getAgentContextValue({ experimental_context }, "conversationId");
        const orgId = getAgentContextValue({ experimental_context }, "orgId");
        const userId = getAgentContextValue({ experimental_context }, "userId");
        const pdfRequestId = getAgentContextValue({ experimental_context }, "pdfRequestId");

        const ctx = conversationId && orgId
          ? { userId: userId ?? "anonymous", orgId, conversationId, ...(pdfRequestId && { pdfRequestId }) }
          : undefined;

        // Load conversation history so the sub-agent has cross-turn context
        const history = conversationId
          ? await loadConversationHistory(convManager, conversationId, ragConfig.windowSize)
          : [];

        const result = await plugin.agent.generate({
          prompt: query,
          messages: history,
          ...(ctx ? { experimental_context: ctx } : {}),
        });

        if (!result.text?.trim()) {
          console.error(`[delegation] ${plugin.id} returned empty response`, {
            steps: result.steps.length,
          });
          return { text: `Error: ${plugin.name} no pudo procesar la solicitud. Inténtalo de nuevo.`, toolResults: [] };
        }

        // Flatten toolResults from all steps — preserves the DelegationResult contract
        const toolResults = result.steps.flatMap((s) => s.toolResults);

        return { text: result.text, toolResults };
      } catch (error) {
        console.error(`[delegation] ${plugin.id} error:`, error);
        return { text: `Error al delegar a ${plugin.name}: ${error instanceof Error ? error.message : "error desconocido"}`, toolResults: [] };
      }
    },
  });
}

/**
 * Creates delegation tools for all registered plugins.
 * Each plugin becomes a single tool the coordinator can invoke.
 */
export function createDelegationTools(plugins: Plugin[], convManager: ConversationManager): AgentTools {
  const tools: AgentTools = {};
  for (const plugin of plugins) {
    const t = createDelegationTool(plugin, convManager);
    tools[`delegateTo_${plugin.id}`] = t;
  }
  return tools;
}
