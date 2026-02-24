import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolEntry } from "./base.js";
import type { LoadedDocument } from "../../ingestion/loader.js";

/**
 * Ingest content into the knowledge base: a URL (YouTube/web) or a plain-text note.
 * - URL  → load via the existing loader pipeline (transcript for YouTube, HTML for web)
 * - Text → store as a plain note document
 * Call this whenever the user shares something to save/remember, not when asking a question.
 */
export const saveNoteEntry: ToolEntry = {
  key: "saveNote",
  create: (_deps) => createSaveNoteTool(),
};

export function createSaveNoteTool() {
  return createTool({
    id: "save-note",
    description: `Save content to the knowledge base so it can be searched later.
Use this when the user:
  - Shares a URL (YouTube, web page) to save/remember
  - Writes a note, idea, quote, reminder, or any text to keep ("guardar:", "nota:", "idea:", "link:", etc.)
  - Shares something declarative without asking a question
Do NOT use this for questions or information requests — use searchDocuments for those.
Returns confirmation with title and chunk count.`,
    inputSchema: z.object({
      content: z
        .string()
        .describe("The URL to ingest OR the plain text of the note/idea to save"),
      title: z
        .string()
        .optional()
        .describe("Optional title for plain-text notes (auto-generated from URL for links)"),
      orgId: z
        .string()
        .optional()
        .describe("Organisation / project scope for multi-tenancy"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      documentId: z.string().optional(),
      chunkCount: z.number().optional(),
      title: z.string().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ content, title, orgId }) => {
      const { processDocument } = await import("../../ingestion/processor.js");

      const isUrl = content.startsWith("http://") || content.startsWith("https://");

      let loaded: LoadedDocument;

      if (isUrl) {
        const { loadDocument } = await import("../../ingestion/loader.js");
        try {
          loaded = await loadDocument(content);
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      } else {
        // Plain text note — build a LoadedDocument directly
        loaded = {
          content,
          metadata: {
            title: title ?? `Note — ${new Date().toISOString().slice(0, 10)}`,
            source: "user-note",
            contentType: "text",
            size: Buffer.byteLength(content, "utf-8"),
          },
        };
      }

      const result = await processDocument(loaded, orgId);

      if (result.status === "failed") {
        return { success: false, documentId: result.documentId, error: result.error };
      }

      return {
        success: true,
        documentId: result.documentId,
        chunkCount: result.chunkCount,
        title: loaded.metadata.title,
      };
    },
  });
}
