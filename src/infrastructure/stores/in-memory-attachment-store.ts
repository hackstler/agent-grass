import type { AttachmentStore, StoredAttachment, AttachmentMetadata } from "../../domain/ports/attachment-store.js";
import { logger } from "../../shared/logger.js";

interface CacheEntry {
  attachment: StoredAttachment;
  docType: string;
  sourceId: string | null;
  timestamp: number;
}

/**
 * In-memory implementation of AttachmentStore (for tests).
 * Scoped by userId — same interface as PersistentAttachmentStore but without DB.
 */
export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = 30 * 60 * 1000) {
    this.maxAgeMs = maxAgeMs;
  }

  async store(params: {
    orgId: string;
    userId: string;
    filename: string;
    attachment: StoredAttachment;
    docType: string;
    sourceId?: string;
  }): Promise<void> {
    this.cleanup();
    const key = `${params.userId}:${params.filename}`;
    this.cache.set(key, {
      attachment: params.attachment,
      docType: params.docType,
      sourceId: params.sourceId ?? null,
      timestamp: Date.now(),
    });
    logger.info({ filename: params.filename, sizeKB: Math.round(params.attachment.base64.length / 1024), storeSize: this.cache.size }, "attachment stored (in-memory)");
  }

  async retrieve(userId: string, filename: string): Promise<StoredAttachment | null> {
    this.cleanup();
    const key = `${userId}:${filename}`;
    const entry = this.cache.get(key);
    if (!entry) {
      logger.info({ filename, userId, storeSize: this.cache.size }, "attachment miss (in-memory)");
      return null;
    }
    logger.info({ filename, userId }, "attachment hit (in-memory)");
    return entry.attachment;
  }

  async list(userId: string, docType?: string): Promise<AttachmentMetadata[]> {
    this.cleanup();
    const results: AttachmentMetadata[] = [];
    for (const [key, entry] of this.cache) {
      if (!key.startsWith(`${userId}:`)) continue;
      if (docType && entry.docType !== docType) continue;
      results.push({
        filename: entry.attachment.filename,
        docType: entry.docType,
        sourceId: entry.sourceId,
        createdAt: new Date(entry.timestamp),
      });
    }
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < cutoff) this.cache.delete(key);
    }
  }
}
