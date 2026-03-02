import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolEntry } from "./base.js";

/**
 * Web search fallback via Perplexity (sonar model).
 * No RAG deps needed — use as-is when knowledge base has no results.
 * Requires PERPLEXITY_API_KEY.
 */
export const searchWebEntry: ToolEntry = {
  key: "searchWeb",
  create: (_deps) => createSearchWebTool(),
};

export function createSearchWebTool() {
  return createTool({
    id: "search-web",
    description: `Search the web for information NOT found in the knowledge base.
ONLY use this as a fallback when searchDocuments returns 0 results AND the user needs current information.
Always tell the user when the answer comes from a web search, not from their documents.`,
    inputSchema: z.object({
      query: z.string().describe("The search query"),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          title: z.string(),
          snippet: z.string(),
          url: z.string(),
        })
      ),
      source: z.literal("web"),
      available: z.boolean(),
    }),
    execute: async ({ query }) => {
      const apiKey = process.env["PERPLEXITY_API_KEY"];

      if (!apiKey) {
        return { results: [], source: "web" as const, available: false };
      }

      const response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: query }],
        }),
      });

      if (!response.ok) {
        return { results: [], source: "web" as const, available: true };
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        citations?: string[];
      };

      const answer = data.choices[0]?.message.content ?? "";
      const citations = data.citations ?? [];

      // First result carries the synthesized answer, rest are citation references
      const results = citations.slice(0, 5).map((url, i) => ({
        title: (() => { try { return new URL(url).hostname; } catch { return url; } })(),
        snippet: i === 0 ? answer.slice(0, 500) : url,
        url,
      }));

      // If no citations, return the answer as a single result
      if (results.length === 0 && answer) {
        results.push({ title: "Web search", snippet: answer.slice(0, 500), url: "" });
      }

      return { results, source: "web" as const, available: true };
    },
  });
}
