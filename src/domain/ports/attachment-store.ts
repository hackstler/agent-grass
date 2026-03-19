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

export interface AttachmentStore {
  /** Store an attachment keyed by filename. Overwrites if the key already exists. */
  store(filename: string, attachment: StoredAttachment): void;
  /** Retrieve an attachment by filename. Returns null if not found or expired. */
  retrieve(filename: string): StoredAttachment | null;
  /** Find the most recently stored attachment matching a filename prefix (e.g., "PRES-"). */
  findLatestByPrefix(prefix: string): StoredAttachment | null;
}
