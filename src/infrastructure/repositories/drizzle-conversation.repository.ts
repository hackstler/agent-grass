import { eq, and, desc, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { conversations, messages } from "../db/schema.js";
import type { Conversation, NewConversation } from "../db/schema.js";
import type {
  ConversationRepository,
  ConversationWithMessages,
  PersistMessagesData,
} from "../../domain/ports/repositories/conversation.repository.js";

export class DrizzleConversationRepository implements ConversationRepository {
  async findById(id: string): Promise<Conversation | null> {
    const result = await db.query.conversations.findFirst({
      where: eq(conversations.id, id),
    });
    return result ?? null;
  }

  async findByIdWithMessages(id: string): Promise<ConversationWithMessages | null> {
    const result = await db.query.conversations.findFirst({
      where: eq(conversations.id, id),
      with: {
        messages: {
          orderBy: asc(messages.createdAt),
          columns: {
            id: true,
            role: true,
            content: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    });
    return result ?? null;
  }

  async findAll(
    filters?: { userId?: string; limit?: number }
  ): Promise<Pick<Conversation, "id" | "title" | "createdAt" | "updatedAt">[]> {
    const limit = Math.min(filters?.limit ?? 20, 100);

    return db.query.conversations.findMany({
      where: filters?.userId ? eq(conversations.userId, filters.userId) : undefined,
      orderBy: desc(conversations.updatedAt),
      limit,
      columns: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByTitle(title: string, userId: string): Promise<Pick<Conversation, "id"> | null> {
    const result = await db.query.conversations.findFirst({
      where: and(eq(conversations.title, title), eq(conversations.userId, userId)),
      columns: { id: true },
    });
    return result ?? null;
  }

  async create(
    data: NewConversation
  ): Promise<Pick<Conversation, "id" | "title" | "createdAt">> {
    const [conv] = await db
      .insert(conversations)
      .values(data)
      .returning({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
      });
    return conv!;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(conversations)
      .where(eq(conversations.id, id))
      .returning({ id: conversations.id });
    return result.length > 0;
  }

  async persistMessages(data: PersistMessagesData): Promise<void> {
    await db.insert(messages).values([
      { conversationId: data.conversationId, role: "user" as const, content: data.userMessage },
      { conversationId: data.conversationId, role: "assistant" as const, content: data.assistantMessage, metadata: data.metadata },
    ]);

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, data.conversationId));
  }
}
