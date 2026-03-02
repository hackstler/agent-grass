import { eq, and, ilike, desc, count, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { documents } from "../db/schema.js";
import type { Document, NewDocument } from "../db/schema.js";
import type { DocumentRepository, ListDocumentsFilters, OrgDocCount } from "../../domain/ports/repositories/document.repository.js";

export class DrizzleDocumentRepository implements DocumentRepository {
  async findById(id: string): Promise<Document | null> {
    const result = await db.query.documents.findFirst({
      where: eq(documents.id, id),
    });
    return result ?? null;
  }

  async findByOrg(orgId: string, filters?: ListDocumentsFilters): Promise<Document[]> {
    const conditions: SQL[] = [eq(documents.orgId, orgId)];

    if (filters?.contentType) {
      conditions.push(
        eq(documents.contentType, filters.contentType as typeof documents.contentType.enumValues[number])
      );
    }

    if (filters?.search) {
      conditions.push(ilike(documents.title, `%${filters.search}%`));
    }

    return db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt));
  }

  async findBySource(orgId: string, source: string): Promise<Document | null> {
    const result = await db.query.documents.findFirst({
      where: and(eq(documents.orgId, orgId), eq(documents.source, source)),
    });
    return result ?? null;
  }

  async create(data: NewDocument): Promise<Document> {
    const [doc] = await db.insert(documents).values(data).returning();
    return doc!;
  }

  async update(id: string, data: Partial<Document>): Promise<Document | null> {
    const [updated] = await db
      .update(documents)
      .set(data)
      .where(eq(documents.id, id))
      .returning();
    return updated ?? null;
  }

  async delete(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.orgId, orgId)))
      .returning({ id: documents.id });
    return result.length > 0;
  }

  async deleteByOrg(orgId: string): Promise<void> {
    await db.delete(documents).where(eq(documents.orgId, orgId));
  }

  async countByOrg(): Promise<OrgDocCount[]> {
    const rows = await db
      .select({ orgId: documents.orgId, docCount: count(documents.id) })
      .from(documents)
      .groupBy(documents.orgId);

    return rows.map((r) => ({
      orgId: r.orgId,
      docCount: Number(r.docCount),
    }));
  }
}
