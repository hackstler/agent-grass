import { db } from "../../infrastructure/db/client.js";
import { messages, conversations } from "../../infrastructure/db/schema.js";
import { eq } from "drizzle-orm";

export async function persistMessages(
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
  metadata: { model?: string; retrievedChunks?: string[] }
): Promise<void> {
  await db.insert(messages).values([
    { conversationId, role: "user", content: userMessage },
    { conversationId, role: "assistant", content: assistantMessage, metadata },
  ]);

  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
