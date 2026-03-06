import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolsInput } from "@mastra/core/agent";
import type { Plugin } from "../plugins/plugin.interface.js";

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
        // Forward requestContext so sub-agent tools can read userId/orgId.
        // Forward memory thread+resource so sub-agents with memory don't crash
        // with "Thread ID is required" from Mastra's output processor.
        const rc = context?.requestContext;
        const threadId = rc?.get("conversationId") as string | undefined;
        const resource = rc?.get("orgId") as string | undefined;

        const result = await plugin.agent.generate(query, {
          ...(rc && { requestContext: rc }),
          ...(threadId && { memory: { thread: threadId, resource: resource ?? "system" } }),
        });

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
