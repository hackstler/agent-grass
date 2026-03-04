import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolEntry } from "./base.js";
import type { LoadedDocument } from "../ingestion/loader.js";

/**
 * Ingest one or multiple URLs / notes into the knowledge base.
 * - URL  → load via the existing loader pipeline (transcript for YouTube, HTML for web)
 * - Text → store as a plain note document
 * - Array → all items processed in parallel
 * Call this whenever the user shares something to save/remember, not when asking a question.
 */
export const saveNoteEntry: ToolEntry = {
  key: "saveNote",
  create: (_deps) => createSaveNoteTool(),
};

export function createSaveNoteTool() {
  return createTool({
    id: "save-note",
    description: `Save one or multiple URLs / notes to the knowledge base so they can be searched later.
Use this when the user:
  - Shares one or more URLs (YouTube, web pages) to save/remember — pass them all at once in the array
  - Writes a note, idea, quote, reminder, or any text to keep ("guardar:", "nota:", "idea:", "link:", etc.)
  - Shares something declarative without asking a question
Do NOT use this for questions or information requests — use searchDocuments for those.
For a list of URLs, pass ALL of them in the 'items' array in a single call — do NOT call this tool once per URL.`,
    inputSchema: z.object({
      items: z
        .array(z.string())
        .min(1)
        .describe("One or more URLs to ingest OR plain-text notes to save"),
    }),
    outputSchema: z.object({
      saved: z.number(),
      failed: z.number(),
      results: z.array(z.object({
        item: z.string(),
        success: z.boolean(),
        title: z.string().optional(),
        chunkCount: z.number().optional(),
        error: z.string().optional(),
      })),
    }),
    execute: async ({ items }, context) => {
      const orgId = context?.requestContext?.get('orgId') as string;
      if (!orgId) throw new Error('Missing orgId in request context');
      const { loadDocument } = await import("../ingestion/loader.js");
      const { processDocument } = await import("../ingestion/processor.js");

      const results = await Promise.all(
        items.map(async (item) => {
          const isUrl = item.startsWith("http://") || item.startsWith("https://");

          let loaded: LoadedDocument;
          try {
            if (isUrl) {
              loaded = await loadDocument(item);
            } else {
              loaded = {
                content: item,
                metadata: {
                  title: `Note — ${new Date().toISOString().slice(0, 10)}`,
                  source: "user-note",
                  contentType: "text",
                  size: Buffer.byteLength(item, "utf-8"),
                },
              };
            }
          } catch (err) {
            return { item, success: false, error: err instanceof Error ? err.message : String(err) };
          }

          const result = await processDocument(loaded, orgId);

          if (result.status === "failed") {
            return { item, success: false, error: result.error };
          }

          return {
            item,
            success: true,
            title: loaded.metadata.title,
            chunkCount: result.chunkCount,
          };
        })
      );

      return {
        saved: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results,
      };
    },
  });
}
