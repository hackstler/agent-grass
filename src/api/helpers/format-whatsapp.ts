/**
 * Convert markdown-formatted text to WhatsApp-friendly plain text.
 *
 * WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```monospace```
 * But NOT: **double asterisks**, # headers, [links](url), bullet dashes, etc.
 */
export function formatForWhatsApp(text: string): string {
  let result = text;

  // Remove source citations the LLM may have added (we append our own)
  result = result.replace(/\[Source:\s*[^\]]*\]/gi, "");
  result = result.replace(/^•\s+.+:\s*https?:\/\/\S+$/gm, "");
  result = result.replace(/^Fuentes?:?\s*$/gim, "");
  result = result.replace(/^Sources?:?\s*$/gim, "");

  // **bold** or __bold__ → *bold* (WhatsApp bold)
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
  result = result.replace(/__(.+?)__/g, "*$1*");

  // ### Header / ## Header / # Header → *Header* (bold)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // [text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Bullet dashes → bullet dots
  result = result.replace(/^[-*]\s+/gm, "• ");

  // Numbered lists: keep as-is (WhatsApp renders them fine)

  // Collapse 3+ consecutive blank lines into 2
  result = result.replace(/\n{3,}/g, "\n\n");

  // Trim trailing whitespace per line and overall
  result = result
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return result;
}

/**
 * Build a sources footer with clickable URLs for WhatsApp.
 * Only includes sources that have a non-empty documentSource URL.
 */
export function buildSourcesFooter(
  sources: Array<{ documentTitle: string; documentSource: string }>
): string {
  const unique = new Map<string, string>();
  for (const s of sources) {
    if (s.documentSource?.trim()) {
      unique.set(s.documentSource, s.documentTitle);
    }
  }

  if (unique.size === 0) return "";

  const lines = Array.from(unique.entries()).map(
    ([url, title]) => `• ${title}\n  ${url}`
  );

  return `\n\n📎 *Fuentes:*\n${lines.join("\n")}`;
}
