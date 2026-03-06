import type { AttachmentStore, StoredAttachment } from "../../domain/ports/attachment-store.js";

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
    console.log(`[attachmentStore] stored: ${filename} (${Math.round(attachment.base64.length / 1024)}KB, store size=${this.cache.size})`);
  }

  retrieve(filename: string): StoredAttachment | null {
    this.cleanup();
    const entry = this.cache.get(filename);
    if (!entry) {
      console.log(`[attachmentStore] miss: ${filename} (store size=${this.cache.size})`);
      return null;
    }
    console.log(`[attachmentStore] hit: ${filename}`);
    return entry.attachment;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < cutoff) this.cache.delete(key);
    }
  }
}
