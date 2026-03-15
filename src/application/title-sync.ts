import type { MastraMemory } from "@mastra/core/memory";
import type { ConversationManager } from "./managers/conversation.manager.js";

/**
 * Fire-and-forget: polls Mastra for an auto-generated title, then syncs it
 * to our conversations table. Retries a few times because Mastra generates
 * titles asynchronously after the agent responds.
 */
export function scheduleTitleSync(
  memory: MastraMemory,
  conversationId: string,
  convManager: ConversationManager,
): void {
  const delays = [5_000, 10_000, 20_000]; // retry at 5s, 10s, 20s

  const attempt = async (index: number) => {
    try {
      const thread = await memory.getThreadById({ threadId: conversationId });
      if (thread?.title && thread.title !== "New conversation") {
        await convManager.updateTitle(conversationId, thread.title);
        return; // success — stop retrying
      }
    } catch {
      // ignore — will retry
    }

    // Schedule next retry if available
    if (index + 1 < delays.length) {
      setTimeout(() => attempt(index + 1), delays[index + 1]! - delays[index]!);
    }
  };

  setTimeout(() => attempt(0), delays[0]!);
}
