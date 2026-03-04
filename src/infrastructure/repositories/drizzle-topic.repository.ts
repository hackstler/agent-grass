import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { topics, documents } from "../db/schema.js";
import type { Topic, NewTopic, Document } from "../db/schema.js";
import type { TopicRepository } from "../../domain/ports/repositories/topic.repository.js";
import { ConflictError } from "../../domain/errors/index.js";

export class DrizzleTopicRepository implements TopicRepository {
  async findById(id: string): Promise<Topic | null> {
    const result = await db.query.topics.findFirst({
      where: eq(topics.id, id),
    });
    return result ?? null;
  }

  async findByOrg(orgId: string): Promise<Topic[]> {
    return db.select().from(topics).where(eq(topics.orgId, orgId)).orderBy(topics.name);
  }

  async findByOrgAndId(orgId: string, id: string): Promise<Topic | null> {
    const result = await db.query.topics.findFirst({
      where: and(eq(topics.id, id), eq(topics.orgId, orgId)),
      columns: { id: true, orgId: true, name: true, description: true, createdAt: true },
    });
    return result ?? null;
  }

  async findDocumentsByTopic(topicId: string): Promise<Document[]> {
    return db
      .select({
        id: documents.id,
        orgId: documents.orgId,
        topicId: documents.topicId,
        title: documents.title,
        source: documents.source,
        contentType: documents.contentType,
        status: documents.status,
        chunkCount: documents.chunkCount,
        metadata: documents.metadata,
        createdAt: documents.createdAt,
        indexedAt: documents.indexedAt,
      })
      .from(documents)
      .where(eq(documents.topicId, topicId))
      .orderBy(documents.createdAt);
  }

  async create(data: NewTopic): Promise<Topic> {
    try {
      const [topic] = await db.insert(topics).values(data).returning();
      return topic!;
    } catch (err: unknown) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === "23505") {
        throw new ConflictError("Topic", `name '${data.name}'`);
      }
      throw err;
    }
  }

  async update(
    id: string,
    orgId: string,
    data: Partial<Pick<Topic, "name" | "description">>
  ): Promise<Topic | null> {
    const [updated] = await db
      .update(topics)
      .set(data)
      .where(and(eq(topics.id, id), eq(topics.orgId, orgId)))
      .returning();
    return updated ?? null;
  }

  async delete(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(topics)
      .where(and(eq(topics.id, id), eq(topics.orgId, orgId)))
      .returning({ id: topics.id });
    return result.length > 0;
  }

  async deleteByOrg(orgId: string): Promise<void> {
    await db.delete(topics).where(eq(topics.orgId, orgId));
  }
}
