import type { Document } from "../../domain/entities/index.js";
import type { DocumentRepository, ListDocumentsFilters } from "../../domain/ports/repositories/document.repository.js";
import { NotFoundError } from "../../domain/errors/index.js";

export class DocumentManager {
  constructor(private readonly repo: DocumentRepository) {}

  async list(orgId: string, filters?: ListDocumentsFilters): Promise<Document[]> {
    return this.repo.findByOrg(orgId, filters);
  }

  async delete(id: string, orgId: string): Promise<void> {
    const deleted = await this.repo.delete(id, orgId);
    if (!deleted) throw new NotFoundError("Document", id);
  }
}
