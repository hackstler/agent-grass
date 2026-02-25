import { toolsConfig } from "../../config/tools.config.js";
import { searchDocumentsEntry } from "./search-documents.js";
import { searchWebEntry } from "./search-web.js";
import { saveNoteEntry } from "./save-note.js";
import type { ToolEntry, ToolRegistryDeps } from "./base.js";

export type { ToolRegistryDeps };

/**
 * All available tools. To add a new tool:
 * 1. Create src/agent/tools/my-tool.ts  (export myToolEntry: ToolEntry)
 * 2. Import and add it here              ← one line
 * 3. Enable it in src/config/tools.config.ts ← one line
 */
const ALL_TOOLS: ToolEntry[] = [
  searchDocumentsEntry,
  searchWebEntry,
  saveNoteEntry,
];

/**
 * Builds the tool object for the Mastra agent.
 * Only includes tools enabled in tools.config.ts.
 */
export function createToolRegistry(deps: ToolRegistryDeps) {
  const enabled = new Set(
    Object.entries(toolsConfig)
      .filter(([, cfg]) => cfg.enabled)
      .map(([key]) => key)
  );

  const activeTools = ALL_TOOLS.filter((t) => enabled.has(t.key));

  console.log(
    "[tools] active:",
    activeTools.map((t) => t.key).join(", ") || "none"
  );

  return Object.fromEntries(activeTools.map((t) => [t.key, t.create(deps)]));
}
