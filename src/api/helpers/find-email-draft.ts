/**
 * Recursively searches a tool result for { draft: true, draftId, preview }.
 * Handles both direct sendEmail results and nested sub-agent delegation results.
 *
 * Used by: chat.routes.ts, internal.controller.ts, webhook.controller.ts
 */

export interface EmailDraftResult {
  draftId: string;
  preview: {
    to: string;
    subject: string;
    body: string;
    attachmentFilename: string | null;
  };
}

export function findEmailDraft(obj: unknown, depth = 0): EmailDraftResult | null {
  if (!obj || typeof obj !== "object" || depth > 5) return null;

  const record = obj as Record<string, unknown>;

  // Direct match: sendEmail result shape
  if (
    record["draft"] === true &&
    typeof record["draftId"] === "string" &&
    record["preview"] &&
    typeof record["preview"] === "object"
  ) {
    const preview = record["preview"] as Record<string, unknown>;
    return {
      draftId: record["draftId"] as string,
      preview: {
        to: (preview["to"] as string) ?? "",
        subject: (preview["subject"] as string) ?? "",
        body: (preview["body"] as string) ?? "",
        attachmentFilename: (preview["attachmentFilename"] as string) ?? null,
      },
    };
  }

  // Recurse into nested objects/arrays (sub-agent delegation wraps results)
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findEmailDraft(item, depth + 1);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findEmailDraft(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
}
