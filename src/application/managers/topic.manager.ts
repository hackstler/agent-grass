import type { Topic, Document } from "../../domain/entities/index.js";
import type { TopicRepository } from "../../domain/ports/repositories/topic.repository.js";
import { NotFoundError, ConflictError } from "../../domain/errors/index.js";

export class TopicManager {
  constructor(private readonly repo: TopicRepository) {}

  async list(orgId: string): Promise<Topic[]> {
    return this.repo.findByOrg(orgId);
  }

  async create(orgId: string, name: string, description?: string): Promise<Topic> {
    try {
      return await this.repo.create({ orgId, name, description });
    } catch (err: unknown) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === "23505") {
        throw new ConflictError("Topic", `name '${name}'`);
      }
      throw err;
    }
  }

  async update(
    id: string,
    orgId: string,
    data: Partial<Pick<Topic, "name" | "description">>
  ): Promise<Topic> {
    const updated = await this.repo.update(id, orgId, data);
    if (!updated) throw new NotFoundError("Topic", id);
    return updated;
  }

  async delete(id: string, orgId: string): Promise<void> {
    const deleted = await this.repo.delete(id, orgId);
    if (!deleted) throw new NotFoundError("Topic", id);
  }

  async getDocuments(id: string, orgId: string): Promise<Document[]> {
    const topic = await this.repo.findByOrgAndId(orgId, id);
    if (!topic) throw new NotFoundError("Topic", id);
    return this.repo.findDocumentsByTopic(id);
  }
}
