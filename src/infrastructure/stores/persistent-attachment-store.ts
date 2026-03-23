import type { AttachmentStore, StoredAttachment, AttachmentMetadata } from "../../domain/ports/attachment-store.js";
import type { AttachmentRepository } from "../../domain/ports/repositories/attachment.repository.js";
import { logger } from "../../shared/logger.js";

interface CacheEntry {
  attachment: StoredAttachment;
  timestamp: number;
}

/**
 * Write-through AttachmentStore: memory cache + DB persistence.
 *
 * Scoped by userId — each seller owns their own attachments.
 * DB access goes through AttachmentRepository (hexagonal architecture).
 *
 * - store(): writes to Map + UPSERTs via repo
 * - retrieve(): checks Map first, on miss → repo query → rehydrates Map
 * - list(): always queries repo (lightweight metadata, no base64)
 */
export class PersistentAttachmentStore implements AttachmentStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxAgeMs: number;
  private readonly maxEntries: number;
  private readonly repo: AttachmentRepository;

  constructor(repo: AttachmentRepository, maxAgeMs = 30 * 60 * 1000, maxEntries = 200) {
    this.repo = repo;
    this.maxAgeMs = maxAgeMs;
    this.maxEntries = maxEntries;
  }

  async store(params: {
    orgId: string;
    userId: string;
    filename: string;
    attachment: StoredAttachment;
    docType: string;
    sourceId?: string;
  }): Promise<void> {
    const { orgId, userId, filename, attachment, docType, sourceId } = params;
    const cacheKey = `${userId}:${filename}`;

    // 1. Write to memory cache
    this.cleanup();
    this.cache.set(cacheKey, { attachment, timestamp: Date.now() });

    logger.info(
      { filename, userId, docType, sizeKB: Math.round(attachment.base64.length / 1024), cacheSize: this.cache.size },
      "attachment stored (cache)",
    );

    // 2. Persist to DB via repository
    try {
      await this.repo.upsert({
        orgId,
        userId,
        filename,
        mimetype: attachment.mimetype,
        base64: attachment.base64,
        docType,
        sourceId: sourceId ?? null,
      });
    } catch (err) {
      logger.error({ err, filename, userId }, "Failed to persist attachment to DB");
    }
  }

  async retrieve(userId: string, filename: string): Promise<StoredAttachment | null> {
    const cacheKey = `${userId}:${filename}`;

    // 1. Check memory cache
    this.cleanup();
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.info({ filename, userId }, "attachment hit (cache)");
      return cached.attachment;
    }

    // 2. Cache miss → query DB via repository
    try {
      const row = await this.repo.findByUserAndFilename(userId, filename);

      if (!row) {
        logger.info({ filename, userId, cacheSize: this.cache.size }, "attachment miss (cache + DB)");
        return null;
      }

      // Rehydrate cache
      const attachment: StoredAttachment = {
        base64: row.base64,
        mimetype: row.mimetype,
        filename: row.filename,
      };
      this.cache.set(cacheKey, { attachment, timestamp: Date.now() });
      logger.info({ filename, userId }, "attachment hit (DB → rehydrated cache)");
      return attachment;
    } catch (err) {
      logger.error({ err, filename, userId }, "Failed to retrieve attachment from DB");
      return null;
    }
  }

  async list(userId: string, docType?: string): Promise<AttachmentMetadata[]> {
    try {
      return await this.repo.listByUser(userId, docType);
    } catch (err) {
      logger.error({ err, userId, docType }, "Failed to list attachments from DB");
      return [];
    }
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < cutoff) this.cache.delete(key);
    }
    if (this.cache.size > this.maxEntries) {
      const entries = [...this.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, this.cache.size - this.maxEntries);
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }
  }
}
