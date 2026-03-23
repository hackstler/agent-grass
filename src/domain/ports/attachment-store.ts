/**
 * Port for cross-plugin attachment storage.
 *
 * Allows one plugin (e.g., Quote) to store generated documents and another
 * plugin (e.g., Gmail) to retrieve them for delivery — without coupling
 * plugins to each other.
 *
 * Implementations are injected via composition root (Dependency Inversion).
 */

export interface StoredAttachment {
  base64: string;
  mimetype: string;
  filename: string;
}

export interface AttachmentMetadata {
  filename: string;
  docType: string;
  sourceId: string | null;
  createdAt: Date;
}

export interface AttachmentStore {
  /** Store an attachment keyed by userId + filename. Overwrites if the key already exists. */
  store(params: {
    orgId: string;
    userId: string;
    filename: string;
    attachment: StoredAttachment;
    docType: string;
    sourceId?: string;
  }): Promise<void>;

  /** Retrieve an attachment by userId + filename. Returns null if not found. */
  retrieve(userId: string, filename: string): Promise<StoredAttachment | null>;

  /** List attachment metadata for a user, optionally filtered by docType. */
  list(userId: string, docType?: string): Promise<AttachmentMetadata[]>;
}
