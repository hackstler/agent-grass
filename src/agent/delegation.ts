import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolsInput } from "@mastra/core/agent";
import type { Plugin } from "../plugins/plugin.interface.js";
import { getAgentContextValue, buildAgentOptions } from "../application/agent-context.js";

/**
 * Creates a single delegation tool that wraps a plugin's agent.
 * The coordinator calls this tool to delegate work to the plugin's specialized agent.
 */
function createDelegationTool(plugin: Plugin) {
  return createTool({
    id: `delegate-to-${plugin.id}`,
    description: `Delegate to ${plugin.name}: ${plugin.description}`,
    inputSchema: z.object({
      query: z.string().describe("The user query or instruction to delegate"),
    }),
    execute: async ({ query }, context) => {
      try {
        // Forward context so sub-agent tools can read userId/orgId and
        // sub-agents with memory don't crash with "Thread ID is required".
        const conversationId = getAgentContextValue(context, "conversationId");
        const orgId = getAgentContextValue(context, "orgId");
        const userId = getAgentContextValue(context, "userId");
        const pdfRequestId = getAgentContextValue(context, "pdfRequestId");

        const opts = conversationId && orgId
          ? buildAgentOptions({ userId: userId ?? "anonymous", orgId, conversationId, ...(pdfRequestId && { pdfRequestId }) })
          : { ...(context?.requestContext && { requestContext: context.requestContext }) };

        const result = await plugin.agent.generate(query, opts);

        if (!result.text?.trim()) {
          console.error(`[delegation] ${plugin.id} returned empty response`, {
            steps: result.steps?.length ?? 0,
          });
          return { text: `Error: ${plugin.name} no pudo procesar la solicitud. Inténtalo de nuevo.`, toolResults: [] };
        }

        // Pass through toolResults so extractSources() and extractPdfFromSteps() keep working.
        const toolResults = result.steps?.flatMap(
          (s: { toolResults?: Array<unknown> }) => s.toolResults ?? []
        ) ?? [];

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
export function createDelegationTools(plugins: Plugin[]): ToolsInput {
  const tools: ToolsInput = {};
  for (const plugin of plugins) {
    const tool = createDelegationTool(plugin);
    tools[`delegateTo_${plugin.id}`] = tool;
  }
  return tools;
}
