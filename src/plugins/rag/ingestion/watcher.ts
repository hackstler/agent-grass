import { logger } from "../../../shared/logger.js";
import { watch } from "fs";
import { join, extname } from "path";
import { readdir, stat } from "fs/promises";
import { loadDocument } from "./loader.js";
import { processDocument } from "./processor.js";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".md", ".mdx", ".html", ".htm", ".txt"]);

/**
 * Watch a directory for new files and auto-ingest them.
 * Useful for document drop-box workflows.
 */
export function watchDirectory(dirPath: string, orgId: string): () => void {
  logger.info({ dirPath }, "Watching directory for new documents");

  const watcher = watch(dirPath, { recursive: false }, async (event, filename) => {
    if (!filename) return;
    if (event !== "rename") return;

    const ext = extname(filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;

    const fullPath = join(dirPath, filename);

    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) return;

      logger.info({ filename }, "New file detected");
      const loaded = await loadDocument(fullPath);
      const result = await processDocument(loaded, orgId);

      if (result.status === "indexed") {
        logger.info({ filename, chunkCount: result.chunkCount }, "File indexed successfully");
      } else {
        logger.error({ filename, error: result.error }, "Failed to index file");
      }
    } catch (error) {
      // File might not exist yet (rename event fires on delete too)
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error({ filename, err: error }, "Error processing file");
      }
    }
  });

  return () => watcher.close();
}

/**
 * Ingest all existing files in a directory (one-time scan).
 */
export async function ingestDirectory(dirPath: string, orgId: string): Promise<void> {
  const entries = await readdir(dirPath);
  const files = entries.filter((f) => SUPPORTED_EXTENSIONS.has(extname(f).toLowerCase()));

  logger.info({ fileCount: files.length, dirPath }, "Found files for ingestion");

  for (const file of files) {
    const fullPath = join(dirPath, file);
    try {
      const loaded = await loadDocument(fullPath);
      const result = await processDocument(loaded, orgId);
      if (result.status === "indexed") {
        logger.info({ file, chunkCount: result.chunkCount }, "File ingested successfully");
      } else {
        logger.error({ file, error: result.error }, "File ingestion failed");
      }
    } catch (error) {
      logger.error({ file, err: error }, "Error loading file for ingestion");
    }
  }
}
