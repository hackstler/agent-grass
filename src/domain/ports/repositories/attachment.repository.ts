export interface AttachmentRow {
  id: string;
  orgId: string;
  userId: string;
  filename: string;
  mimetype: string;
  base64: string;
  docType: string;
  sourceId: string | null;
  createdAt: Date;
}

export interface NewAttachmentRow {
  orgId: string;
  userId: string;
  filename: string;
  mimetype: string;
  base64: string;
  docType: string;
  sourceId: string | null;
}

export interface AttachmentRepository {
  upsert(data: NewAttachmentRow): Promise<void>;
  findByUserAndFilename(userId: string, filename: string): Promise<AttachmentRow | null>;
  listByUser(userId: string, docType?: string): Promise<Pick<AttachmentRow, "filename" | "docType" | "sourceId" | "createdAt">[]>;
}
