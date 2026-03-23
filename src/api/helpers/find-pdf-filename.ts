/**
 * Recursively searches a tool result for { pdfGenerated: true, filename: "*.pdf" }.
 * Handles both direct calculateBudget results and nested sub-agent delegation results.
 *
 * Used by: chat.routes.ts, internal.controller.ts, webhook.controller.ts
 */
export function findPdfFilename(obj: unknown, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 5) return null;

  const record = obj as Record<string, unknown>;

  // Direct match: calculateBudget result shape
  if (record["pdfGenerated"] === true && typeof record["filename"] === "string") {
    return record["filename"] as string;
  }

  // Recurse into nested objects/arrays (sub-agent delegation wraps results)
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findPdfFilename(item, depth + 1);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findPdfFilename(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
}
