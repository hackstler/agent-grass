#!/usr/bin/env node
/**
 * Re-ingest all indexed documents for an org with the new enriched pipeline.
 *
 * Usage:
 *   npx tsx scripts/re-ingest.ts --org hackstler
 *   npx tsx scripts/re-ingest.ts --org hackstler --dry-run
 */
import "dotenv/config";
import { db } from "../src/infrastructure/db/client.js";
import { documents } from "../src/infrastructure/db/schema.js";
import { eq, and } from "drizzle-orm";
import { loadDocument } from "../src/ingestion/loader.js";
import { processDocument } from "../src/ingestion/processor.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: npx tsx scripts/re-ingest.ts --org <orgId> [options]

Options:
  --org <orgId>   Organization ID (required)
  --dry-run       List documents without re-ingesting
  --help, -h      Show this message
`);
  process.exit(0);
}

const orgIdx = args.indexOf("--org");
const orgId = orgIdx !== -1 ? args[orgIdx + 1] : undefined;
const isDryRun = args.includes("--dry-run");

if (!orgId) {
  console.error("Error: --org <orgId> is required");
  process.exit(1);
}

async function main() {
  // Fetch all indexed documents for this org
  const docs = await db.query.documents.findMany({
    where: and(eq(documents.orgId, orgId!), eq(documents.status, "indexed")),
    columns: { id: true, title: true, source: true, contentType: true },
    orderBy: documents.createdAt,
  });

  console.log(`\nFound ${docs.length} indexed documents for org "${orgId}"\n`);

  if (docs.length === 0) {
    process.exit(0);
  }

  if (isDryRun) {
    for (const [i, doc] of docs.entries()) {
      console.log(`  [${i + 1}/${docs.length}] "${doc.title}" (${doc.source})`);
    }
    console.log("\n[dry-run] No documents were re-ingested.");
    process.exit(0);
  }

  let succeeded = 0;
  let failed = 0;

  for (const [i, doc] of docs.entries()) {
    const start = Date.now();
    const prefix = `[${i + 1}/${docs.length}]`;

    try {
      console.log(`${prefix} Loading "${doc.title}"...`);
      const loaded = await loadDocument(doc.source);
      const result = await processDocument(loaded, orgId);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (result.status === "indexed") {
        console.log(`${prefix} ✓ "${doc.title}" → ${result.chunkCount} chunks (${elapsed}s)`);
        succeeded++;
      } else {
        console.log(`${prefix} ✗ "${doc.title}" — ${result.error} (${elapsed}s)`);
        failed++;
      }
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${prefix} ✗ "${doc.title}" — ${message} (${elapsed}s)`);
      failed++;
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Done: ${succeeded} re-indexed, ${failed} failed out of ${docs.length} total\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
