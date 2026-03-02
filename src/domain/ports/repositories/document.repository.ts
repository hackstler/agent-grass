import type { Document, NewDocument } from "../../entities/index.js";

export interface ListDocumentsFilters {
  contentType?: string;
  search?: string;
}

export interface OrgDocCount {
  orgId: string | null;
  docCount: number;
}

export interface DocumentRepository {
  findById(id: string): Promise<Document | null>;
  findByOrg(orgId: string, filters?: ListDocumentsFilters): Promise<Document[]>;
  findBySource(orgId: string, source: string): Promise<Document | null>;
  create(data: NewDocument): Promise<Document>;
  update(id: string, data: Partial<Document>): Promise<Document | null>;
  delete(id: string, orgId: string): Promise<boolean>;
  deleteByOrg(orgId: string): Promise<void>;
  countByOrg(): Promise<OrgDocCount[]>;
}
