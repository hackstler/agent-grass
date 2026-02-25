#!/usr/bin/env node
/**
 * Batch YouTube ingestion from a Markdown file.
 *
 * File format:
 *   # collection-name        ← becomes orgId (optional, defaults to "default")
 *   https://youtube.com/...
 *   https://youtu.be/...
 *
 * Usage:
 *   npm run ingest:youtube -- --file ./my-videos.md
 *   npm run ingest:youtube -- --file ./my-videos.md --dry-run
 *   npm run ingest:youtube -- --file ./my-videos.md --collection cooking
 */
import "dotenv/config";
import { readFile } from "fs/promises";
import { loadDocument } from "../src/ingestion/loader.js";
import { processDocument } from "../src/ingestion/processor.js";
import type { LoadOptions } from "../src/ingestion/loader.js";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage: npm run ingest:youtube -- --file <path> [options]

Options:
  --file <path>          Markdown file with YouTube URLs (required)
  --collection <name>    Override orgId for all URLs in the file
  --dry-run              Parse the file and show what would be ingested, without doing it
  --help, -h             Show this message

File format:
  # counter-strike                        ← section title becomes orgId
  @vision: Analiza la táctica: mapa, utility, posición, lado T o CT.
  https://youtube.com/watch?v=ID
  https://youtube.com/shorts/ID
  > Flash de entrada al site B desde banana  ← curator annotation for the URL above
  https://youtu.be/ID

  # cooking
  @vision: Describe the dish: name, ingredients, cooking technique.
  https://youtube.com/watch?v=ID

Directives:
  @vision: <prompt>   Section-level Vision AI prompt (applied to all URLs in the section)
  > <text>            URL-level curator annotation (injected when no transcript/vision available)
`);
  process.exit(0);
}

const fileIdx = args.indexOf("--file");
const filePath = fileIdx !== -1 ? args[fileIdx + 1] : undefined;
const collectionOverride = args.indexOf("--collection") !== -1
  ? args[args.indexOf("--collection") + 1]
  : undefined;
const isDryRun = args.includes("--dry-run");

if (!filePath) {
  console.error("Error: --file <path> is required");
  process.exit(1);
}

// ─── Parse markdown file ──────────────────────────────────────────────────────

interface UrlEntry {
  url: string;
  orgId: string;
  annotation?: string;
  visionPrompt?: string;
}

async function parseFile(path: string): Promise<UrlEntry[]> {
  const content = await readFile(path, "utf-8");
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  const entries: UrlEntry[] = [];
  let currentSection = "default";
  let currentVisionPrompt: string | undefined;

  for (const line of lines) {
    if (line.startsWith("#")) {
      // "# Counter-Strike" → "counter-strike"
      currentSection = line.replace(/^#+\s*/, "").trim().toLowerCase().replace(/\s+/g, "-");
      currentVisionPrompt = undefined; // reset per section
      continue;
    }

    if (line.startsWith("@vision:")) {
      // "@vision: Describe el plato..." → section-level vision prompt
      currentVisionPrompt = line.replace(/^@vision:\s*/, "").trim();
      continue;
    }

    if (line.startsWith(">")) {
      // "> annotation text" → attach to the last URL entry
      if (entries.length > 0) {
        entries[entries.length - 1]!.annotation = line.replace(/^>\s*/, "").trim();
      }
      continue;
    }

    if (line.startsWith("http://") || line.startsWith("https://")) {
      // Strip trailing markdown formatting if any (e.g. "- https://...")
      const url = line.replace(/^[-*]\s*/, "");
      entries.push({
        url,
        orgId: collectionOverride ?? currentSection,
        visionPrompt: currentVisionPrompt,
      });
    }
  }

  return entries;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

interface Result {
  url: string;
  orgId: string;
  title?: string;
  chunks?: number;
  error?: string;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const entries = await parseFile(filePath!);

  if (entries.length === 0) {
    console.log("No YouTube URLs found in the file.");
    process.exit(0);
  }

  // Group by collection for display
  const byCollection = new Map<string, UrlEntry[]>();
  for (const e of entries) {
    if (!byCollection.has(e.orgId)) byCollection.set(e.orgId, []);
    byCollection.get(e.orgId)!.push(e);
  }

  console.log(`\nFound ${entries.length} URLs across ${byCollection.size} collection(s):`);
  for (const [orgId, items] of byCollection) {
    console.log(`  ${orgId}: ${items.length} videos`);
  }

  if (isDryRun) {
    console.log("\n[dry-run] No documents were ingested.");
    process.exit(0);
  }

  console.log("\nStarting ingestion...\n");

  const results: Result[] = [];

  for (const [orgId, items] of byCollection) {
    console.log(`── ${orgId} (${items.length} videos)`);

    for (const { url, annotation, visionPrompt } of items) {
      const start = Date.now();

      try {
        const loadOpts: LoadOptions = {};
        if (visionPrompt) loadOpts.visionPrompt = visionPrompt;

        const loaded = await loadDocument(url, loadOpts);
        const meta = loaded.metadata as Record<string, unknown>;

        // Inject curator annotation when no transcript and no Vision AI analysis
        if (annotation && !meta["hasTranscript"] && !meta["hasVisualAnalysis"]) {
          loaded.content += `\n\nNotas del curador:\n${annotation}`;
          meta["hasAnnotation"] = true;
        }

        const result = await processDocument(loaded, orgId);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);

        if (result.status === "indexed") {
          const hasTranscript = meta["hasTranscript"];
          const hasVisual = meta["hasVisualAnalysis"];
          const hasAnnotation = meta["hasAnnotation"];
          const note = hasTranscript ? "" : hasVisual ? " (visual AI)" : hasAnnotation ? " (annotation)" : " (no transcript)";
          console.log(`  ✓ ${loaded.metadata.title} — ${result.chunkCount} chunks${note} (${elapsed}s)`);
          results.push({ url, orgId, title: loaded.metadata.title, chunks: result.chunkCount });
        } else {
          console.log(`  ✗ ${url} — ${result.error}`);
          results.push({ url, orgId, error: result.error });
        }
      } catch (err) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const message = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ ${url} — ${message} (${elapsed}s)`);
        results.push({ url, orgId, error: message });
      }
    }

    console.log();
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  const succeeded = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  console.log("─".repeat(50));
  console.log(`Done: ${succeeded.length} indexed, ${failed.length} failed\n`);

  if (succeeded.length > 0) {
    const byOrgId = new Map<string, Result[]>();
    for (const r of succeeded) {
      if (!byOrgId.has(r.orgId)) byOrgId.set(r.orgId, []);
      byOrgId.get(r.orgId)!.push(r);
    }
    for (const [orgId, items] of byOrgId) {
      const totalChunks = items.reduce((sum, r) => sum + (r.chunks ?? 0), 0);
      console.log(`  ${orgId}: ${items.length} videos, ${totalChunks} chunks`);
    }
    console.log();
    console.log("Test it:");
    const firstOrgId = succeeded[0]!.orgId;
    console.log(`  curl -X POST http://localhost:3000/chat \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"query":"<your question>","orgId":"${firstOrgId}"}'`);
  }

  if (failed.length > 0) {
    console.log("\nFailed URLs:");
    for (const r of failed) {
      console.log(`  ${r.url}\n  → ${r.error}\n`);
    }
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[fatal]", err.message);
  process.exit(1);
});
