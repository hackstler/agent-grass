import { tool } from "ai";
import { z } from "zod";
import type { AgentTools, DelegationResult, MediaAttachment } from "./types.js";
import type { Plugin } from "../plugins/plugin.interface.js";
import { getAgentContextValue } from "../application/agent-context.js";
import { loadConversationHistory } from "./load-history.js";
import { takePendingMedia, storePendingMedia } from "./pending-media.js";
import { extractReceiptData, validateExtraction, formatExtractionForAgent } from "../plugins/expenses/services/receipt-extractor.js";
import type { ConversationManager } from "../application/managers/conversation.manager.js";
import { ragConfig } from "../plugins/rag/config/rag.config.js";
import { logger } from "../shared/logger.js";
import { getToolPermission } from "./permissions.js";
import { verifyDelegationResult } from "./verification.js";

/**
 * Wraps a plugin's tools with permission checks.
 * Tools with 'confirm' permission that are called without CONFIRMED: prefix
 * return a description of what they would do instead of executing.
 * Tools with 'deny' permission always return an error.
 */
function wrapToolsWithPermissions(tools: AgentTools, query: string): AgentTools {
  const wrapped: AgentTools = {};
  const isConfirmed = query.startsWith("CONFIRMED:");

  for (const [name, t] of Object.entries(tools)) {
    const permission = getToolPermission(name);

    if (permission.level === "deny") {
      wrapped[name] = tool({
        description: (t as Record<string, unknown>)["description"] as string ?? name,
        inputSchema: z.object({ _reason: z.string().optional() }),
        execute: async () => ({
          error: true,
          message: `La acción "${name}" no está permitida en esta organización.`,
        }),
      });
    } else if (permission.level === "confirm" && !isConfirmed) {
      // Pass through the original tool but with a wrapped execute that blocks
      // We keep the original inputSchema so the LLM can still fill the parameters
      const originalSchema = (t as Record<string, unknown>)["inputSchema"];
      wrapped[name] = tool({
        description: (t as Record<string, unknown>)["description"] as string ?? name,
        inputSchema: originalSchema as z.ZodObject<z.ZodRawShape> ?? z.object({ input: z.string().optional() }),
        execute: async (input) => ({
          needsConfirmation: true,
          toolName: name,
          message: permission.message ?? `¿Confirmas la acción "${name}"?`,
          proposedInput: input,
        }),
      });
    } else {
      // Auto or confirmed → pass through unchanged
      wrapped[name] = t;
    }
  }

  return wrapped;
}

/**
 * Creates a single delegation tool that wraps a plugin's agent.
 * The coordinator calls this tool to delegate work to the plugin's specialized agent.
 *
 * Conversation history is loaded from the DB and passed to the sub-agent so it can
 * understand context from previous turns (names, topics, references).
 *
 * Features:
 * - Permission-wrapped tools: sub-agent tools are wrapped with permission checks
 * - Post-delegation verification: results are validated with programmatic rules
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
        const ctx = conversationId && orgId
          ? { userId: userId ?? "anonymous", orgId, conversationId }
          : undefined;

        // Load conversation history so the sub-agent has cross-turn context
        const history = conversationId
          ? await loadConversationHistory(convManager, conversationId, ragConfig.windowSize)
          : [];

        // Forward any pending media attachments (images/docs from this request)
        let attachments: MediaAttachment[] | undefined = conversationId
          ? takePendingMedia(conversationId)
          : undefined;

        // ── Gather phase: structured extraction for expenses with images ────
        // Uses generateObject (schema-constrained) instead of free-form LLM prose.
        // The conversational agent then handles confirmation, NOT extraction.
        if (plugin.id === "expenses" && attachments?.length) {
          logger.info({ mediaCount: attachments.length }, "Running structured receipt extraction");
          const extracted = await extractReceiptData(attachments[0]!);
          if (extracted) {
            const issues = validateExtraction(extracted);
            const enrichedQuery = formatExtractionForAgent(extracted, issues);
            query = enrichedQuery;
            // Re-store media so tools (e.g. uploadReceiptToDrive) can still access it
            if (conversationId) storePendingMedia(conversationId, attachments);
            attachments = undefined; // don't pass raw image to the conversational agent
            logger.info({ vendor: extracted.vendor, amount: extracted.amount, confidence: extracted.confidence, issues }, "Receipt extraction complete");
          } else {
            query = "No se pudo analizar la imagen. Dile al usuario que la imagen no es legible y que la envíe de nuevo.";
            attachments = undefined;
          }
        } else if (attachments?.length) {
          logger.info({ pluginId: plugin.id, mediaCount: attachments.length }, "Forwarding media to sub-agent");
        }

        // Wrap plugin tools with permission checks
        const wrappedTools = wrapToolsWithPermissions(plugin.tools, query);

        const result = await plugin.agent.generate({
          prompt: query,
          messages: history,
          ...(ctx ? { experimental_context: ctx } : {}),
          tools: wrappedTools,
          ...(attachments?.length ? { attachments } : {}),
        });

        if (!result.text?.trim()) {
          logger.error({ pluginId: plugin.id, steps: result.steps.length }, "Plugin returned empty response");
          return { text: `Error: ${plugin.name} no pudo procesar la solicitud. Inténtalo de nuevo.`, toolResults: [] };
        }

        // Flatten toolResults from all steps — preserves the DelegationResult contract
        const toolResults = result.steps.flatMap((s) => s.toolResults);

        // Post-delegation verification
        const verification = verifyDelegationResult(plugin.id, { text: result.text, toolResults });
        if (!verification.valid) {
          logger.warn({ pluginId: plugin.id, reason: verification.reason }, "Delegation verification failed");
          return {
            text: result.text + `\n\n⚠️ Nota: ${verification.reason}`,
            toolResults,
          };
        }

        return { text: result.text, toolResults };
      } catch (error) {
        logger.error({ err: error, pluginId: plugin.id }, "Delegation error");
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
