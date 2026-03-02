/**
 * Extract source chunks from Mastra agent tool results.
 * Shared between chat.ts (REST API) and internal.ts (worker API).
 */
export interface ExtractedSource {
  id: string;
  documentTitle: string;
  documentSource: string;
  score: number;
  excerpt: string;
}

export function extractSources(
  steps: Array<{ toolResults?: Array<unknown> }>
): ExtractedSource[] {
  const allToolResults = steps.flatMap((s) => s.toolResults ?? []);

  // Mastra 1.5 wraps tool results in a payload object
  const searchResult = allToolResults.find((r) => {
    const payload = (r as { payload?: { toolName?: string } }).payload;
    return payload?.toolName === "searchDocuments";
  });
  if (!searchResult) return [];

  const res = (searchResult as { payload: { result?: unknown } }).payload.result as {
    chunks?: Array<{
      id: string;
      documentTitle: string;
      documentSource: string;
      score: number;
      content: string;
    }>;
  } | undefined;

  return (res?.chunks ?? []).map((c) => ({
    id: c.id,
    documentTitle: c.documentTitle,
    documentSource: c.documentSource,
    score: c.score,
    excerpt: c.content.slice(0, 200) + (c.content.length > 200 ? "\u2026" : ""),
  }));
}
