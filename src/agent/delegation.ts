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
      orgId: z.string().describe("Organization ID for multi-tenant context"),
    }),
    execute: async ({ query, orgId }) => {
      const enriched = `${query}\n[org:${orgId}]`;

      // Generate WITHOUT memory — the coordinator already manages conversation memory.
      const result = await plugin.agent.generate(enriched);

      // Pass through toolResults so extractSources() and extractPdfFromSteps() keep working.
      const toolResults = result.steps?.flatMap(
        (s: { toolResults?: Array<unknown> }) => s.toolResults ?? []
      ) ?? [];

      return { text: result.text, toolResults };
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
