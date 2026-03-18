import type { ModelMessage } from "ai";
import type { ConversationManager } from "../application/managers/conversation.manager.js";
import type { ToolCallSummary } from "../domain/entities/index.js";
import { ragConfig } from "../plugins/rag/config/rag.config.js";

/**
 * Load the last N messages from our DB as ModelMessage[].
 *
 * For assistant messages with persisted tool call metadata, the tool context
 * is prepended so the LLM knows what it did in previous turns — preventing
 * redundant tool calls and enabling cross-turn references (e.g., PDF filenames).
 *
 * Default window size comes from ragConfig.windowSize (currently 10).
 */
export async function loadConversationHistory(
  convManager: ConversationManager,
  conversationId: string,
  windowSize = ragConfig.windowSize,
): Promise<ModelMessage[]> {
  try {
    const conv = await convManager.getById(conversationId);
    const messages = conv.messages ?? [];

    const recent = messages.slice(-windowSize);

    return recent.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: enrichWithToolContext(m.role, m.content, m.metadata?.toolCalls),
    }));
  } catch {
    // Conversation may not exist yet
    return [];
  }
}

/**
 * For assistant messages that used tools, prepend a brief summary so the LLM
 * has continuity across turns without re-calling the same tools.
 */
function enrichWithToolContext(
  role: string,
  content: string,
  toolCalls?: ToolCallSummary[],
): string {
  if (role !== "assistant" || !toolCalls?.length) return content;

  const summary = toolCalls.map((tc) => tc.summary).join("; ");
  return `[Herramientas: ${summary}]\n${content}`;
}
