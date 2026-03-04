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
  console.log(`[watcher] Watching ${dirPath} for new documents...`);

  const watcher = watch(dirPath, { recursive: false }, async (event, filename) => {
    if (!filename) return;
    if (event !== "rename") return;

    const ext = extname(filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;

    const fullPath = join(dirPath, filename);

    try {
      const fileStat = await stat(fullPath);
      if (!fileStat.isFile()) return;

      console.log(`[watcher] New file detected: ${filename}`);
      const loaded = await loadDocument(fullPath);
      const result = await processDocument(loaded, orgId);

      if (result.status === "indexed") {
        console.log(`[watcher] Indexed ${filename}: ${result.chunkCount} chunks`);
      } else {
        console.error(`[watcher] Failed to index ${filename}: ${result.error}`);
      }
    } catch (error) {
      // File might not exist yet (rename event fires on delete too)
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`[watcher] Error processing ${filename}:`, error);
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

  console.log(`[ingest] Found ${files.length} files in ${dirPath}`);

  for (const file of files) {
    const fullPath = join(dirPath, file);
    try {
      const loaded = await loadDocument(fullPath);
      const result = await processDocument(loaded, orgId);
      console.log(
        result.status === "indexed"
          ? `[ingest] ✓ ${file} (${result.chunkCount} chunks)`
          : `[ingest] ✗ ${file}: ${result.error}`
      );
    } catch (error) {
      console.error(`[ingest] Error loading ${file}:`, error);
    }
  }
}
