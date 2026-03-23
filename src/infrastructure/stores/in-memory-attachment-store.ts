import type { AttachmentStore, StoredAttachment } from "../../domain/ports/attachment-store.js";
import { logger } from "../../shared/logger.js";

interface CacheEntry {
  attachment: StoredAttachment;
  timestamp: number;
}

/**
 * In-memory implementation of AttachmentStore with TTL-based cleanup.
 *
 * Stores documents (PDFs, etc.) keyed by filename so they can be retrieved
 * across different requests within the TTL window.
 *
 * Singleton instance shared between plugins — created once in composition root.
 */
export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = 30 * 60 * 1000) {
    this.maxAgeMs = maxAgeMs;
  }

  store(filename: string, attachment: StoredAttachment): void {
    this.cleanup();
    this.cache.set(filename, { attachment, timestamp: Date.now() });
    logger.info({ filename, sizeKB: Math.round(attachment.base64.length / 1024), storeSize: this.cache.size }, "attachment stored");
  }

  retrieve(filename: string): StoredAttachment | null {
    this.cleanup();
    const entry = this.cache.get(filename);
    if (!entry) {
      const keys = [...this.cache.keys()];
      logger.info({ filename, storeSize: this.cache.size, keys }, "attachment miss");
      return null;
    }
    logger.info({ filename }, "attachment hit");
    return entry.attachment;
  }

  findLatestByPrefix(prefix: string): StoredAttachment | null {
    this.cleanup();
    let latest: CacheEntry | null = null;
    for (const [key, entry] of this.cache) {
      if (key.startsWith(prefix) && (!latest || entry.timestamp > latest.timestamp)) {
        latest = entry;
      }
    }
    if (latest) {
      logger.info({ prefix, matchedFilename: latest.attachment.filename }, "attachment prefix match");
    }
    return latest?.attachment ?? null;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < cutoff) this.cache.delete(key);
    }
  }
}
