#!/usr/bin/env node
/**
 * CLI para ingestar documentos desde la línea de comandos.
 * Uso: npm run ingest -- <ruta-o-url> [--org-id <id>]
 *
 * Ejemplos:
 *   npm run ingest -- ./docs/manual.pdf
 *   npm run ingest -- ./docs/ --dir
 *   npm run ingest -- https://example.com/docs --org-id acme
 */
import "dotenv/config";
import { loadDocument } from "./loader.js";
import { processDocument } from "./processor.js";
import { ingestDirectory } from "./watcher.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: npm run ingest -- <path-or-url> [options]

Arguments:
  <path-or-url>   File path, directory path, or URL to ingest

Options:
  --dir           Treat the path as a directory and ingest all supported files
  --org-id <id>   Organization ID for multi-tenant setups
  --help, -h      Show this help message

Supported file types: .pdf, .md, .mdx, .html, .htm, .txt, and code files

Examples:
  npm run ingest -- ./manual.pdf
  npm run ingest -- ./docs/ --dir
  npm run ingest -- https://example.com/api-reference
  npm run ingest -- ./docs/ --dir --org-id acme
`);
  process.exit(0);
}

const source = args[0]!;
const isDir = args.includes("--dir");
const orgIdIdx = args.indexOf("--org-id");
const orgIdRaw = orgIdIdx !== -1 ? args[orgIdIdx + 1] : undefined;

if (!orgIdRaw) {
  console.error("[ingest] Error: --org-id is required for multi-tenant ingestion.");
  process.exit(1);
}

const orgId: string = orgIdRaw;

async function main() {
  console.log(`[ingest] Source: ${source}`);
  if (orgId) console.log(`[ingest] Org ID: ${orgId}`);

  if (isDir) {
    await ingestDirectory(source, orgId);
    console.log("[ingest] Directory ingestion complete.");
    return;
  }

  // Single file or URL
  const startTime = Date.now();

  console.log("[ingest] Loading document...");
  const loaded = await loadDocument(source);
  console.log(`[ingest] Loaded: "${loaded.metadata.title}" (${(loaded.metadata.size / 1024).toFixed(1)} KB)`);

  console.log("[ingest] Processing (chunking + embedding + storing)...");
  const result = await processDocument(loaded, orgId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (result.status === "indexed") {
    console.log(`
[ingest] ✓ Done in ${elapsed}s
  Document ID : ${result.documentId}
  Chunks      : ${result.chunkCount}
  Status      : indexed

Test it:
  curl -X POST http://localhost:3000/chat \\
    -H "Content-Type: application/json" \\
    -d '{"query": "What is this document about?"}'
`);
  } else {
    console.error(`
[ingest] ✗ Failed after ${elapsed}s
  Document ID : ${result.documentId}
  Error       : ${result.error}
`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[ingest] Fatal error:", err.message);
  process.exit(1);
});
