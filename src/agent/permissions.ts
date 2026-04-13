/**
 * Declarative tool permission system.
 *
 * Permission levels:
 * - 'auto': Tool executes without any user confirmation
 * - 'confirm': Tool requires explicit user confirmation before execution
 * - 'deny': Tool is blocked entirely (can be configured per-org in the future)
 *
 * The delegation layer uses this to wrap sub-agent tools:
 * - For 'confirm' tools: if the query doesn't start with "CONFIRMED:", the tool
 *   returns a description of what it WOULD do instead of executing.
 * - For 'deny' tools: always returns an error.
 * - For 'auto' tools: normal execution.
 */

export type PermissionLevel = "auto" | "confirm" | "deny";

export interface ToolPermission {
  level: PermissionLevel;
  /** Human-readable description template for confirmation. Supports {fieldName} placeholders. */
  message?: string;
}

/**
 * Default permission map for all known tools.
 * Tools not in this map default to 'auto'.
 */
const defaultPermissions: Record<string, ToolPermission> = {
  // ── Auto (no confirmation needed) ────────────────────────────────────────
  searchDocuments: { level: "auto" },
  searchWeb: { level: "auto" },
  saveNote: { level: "auto" },
  listEmails: { level: "auto" },
  readEmail: { level: "auto" },
  searchEmails: { level: "auto" },
  listEvents: { level: "auto" },
  listCatalogs: { level: "auto" },
  listCatalogItems: { level: "auto" },
  listCatalog: { level: "auto" },
  listQuotes: { level: "auto" },
  searchVideos: { level: "auto" },
  getVideoDetails: { level: "auto" },
  recallMemory: { level: "auto" },
  saveMemory: { level: "auto" },
  deleteMemory: { level: "auto" },
  listExpenses: { level: "auto" },
  getExpenseSummary: { level: "auto" },
  recordExpense: { level: "auto" },
  uploadReceiptToDrive: { level: "auto" },

  // ── Confirm (needs user approval) ────────────────────────────────────────
  // Note: sendEmail already uses the draft+UI-confirm pattern,
  // so programmatic confirmation is NOT needed for it.
  // These tools execute actions that are harder to undo:
  deleteEvent: { level: "confirm", message: "¿Eliminar este evento del calendario?" },
  deleteItem: { level: "confirm", message: "¿Eliminar este producto del catálogo?" },
};

/**
 * Get the permission level for a tool.
 * Returns 'auto' for unknown tools.
 */
export function getToolPermission(toolName: string): ToolPermission {
  return defaultPermissions[toolName] ?? { level: "auto" };
}

/**
 * Check if a tool requires confirmation and the query doesn't contain the CONFIRMED: prefix.
 */
export function needsConfirmation(toolName: string, query: string): boolean {
  const perm = getToolPermission(toolName);
  if (perm.level !== "confirm") return false;
  return !query.startsWith("CONFIRMED:");
}

/**
 * Check if a tool is denied.
 */
export function isDenied(toolName: string): boolean {
  return getToolPermission(toolName).level === "deny";
}
