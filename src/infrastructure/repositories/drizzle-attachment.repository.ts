import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { attachments } from "../db/schema.js";
import type {
  AttachmentRepository,
  AttachmentRow,
  NewAttachmentRow,
} from "../../domain/ports/repositories/attachment.repository.js";

export class DrizzleAttachmentRepository implements AttachmentRepository {
  async upsert(data: NewAttachmentRow): Promise<void> {
    await db
      .insert(attachments)
      .values(data)
      .onConflictDoUpdate({
        target: [attachments.userId, attachments.filename],
        set: {
          mimetype: data.mimetype,
          base64: data.base64,
          docType: data.docType,
          sourceId: data.sourceId,
        },
      });
  }

  async findByUserAndFilename(userId: string, filename: string): Promise<AttachmentRow | null> {
    const [row] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.userId, userId), eq(attachments.filename, filename)))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      orgId: row.orgId,
      userId: row.userId!,
      filename: row.filename,
      mimetype: row.mimetype,
      base64: row.base64,
      docType: row.docType,
      sourceId: row.sourceId,
      createdAt: row.createdAt,
    };
  }

  async listByUser(
    userId: string,
    docType?: string,
  ): Promise<Pick<AttachmentRow, "filename" | "docType" | "sourceId" | "createdAt">[]> {
    const conditions = docType
      ? and(eq(attachments.userId, userId), eq(attachments.docType, docType))
      : eq(attachments.userId, userId);

    return db
      .select({
        filename: attachments.filename,
        docType: attachments.docType,
        sourceId: attachments.sourceId,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(conditions)
      .orderBy(desc(attachments.createdAt));
  }
}
