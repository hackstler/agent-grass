import type { Topic, NewTopic, Document } from "../../entities/index.js";

export interface TopicRepository {
  findById(id: string): Promise<Topic | null>;
  findByOrg(orgId: string): Promise<Topic[]>;
  findByOrgAndId(orgId: string, id: string): Promise<Topic | null>;
  findDocumentsByTopic(topicId: string): Promise<Document[]>;
  create(data: NewTopic): Promise<Topic>;
  update(id: string, orgId: string, data: Partial<Pick<Topic, "name" | "description">>): Promise<Topic | null>;
  delete(id: string, orgId: string): Promise<boolean>;
  deleteByOrg(orgId: string): Promise<void>;
}
