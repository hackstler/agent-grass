import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export function createDeleteItemTool(catalogManager: CatalogManager) {
  return createTool({
    id: "deleteCatalogItem",
    description:
      "Delete an item from a catalog. The agent should confirm with the user before calling this.",

    inputSchema: z.object({
      catalogId: z.string().describe("The catalog ID the item belongs to"),
      itemId: z.string().describe("The item ID to delete"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),

    execute: async ({ catalogId, itemId }, context) => {
      const orgId = getAgentContextValue(context, "orgId");
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        await catalogManager.deleteItem(orgId, catalogId, itemId);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
