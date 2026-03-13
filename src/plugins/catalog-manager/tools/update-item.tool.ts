import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export function createUpdateItemTool(catalogManager: CatalogManager) {
  return createTool({
    id: "updateCatalogItem",
    description:
      "Update an existing catalog item. Only provide the fields that need to change.",

    inputSchema: z.object({
      catalogId: z.string().describe("The catalog ID the item belongs to"),
      itemId: z.string().describe("The item ID to update"),
      name: z.string().optional().describe("New product name"),
      pricePerUnit: z.string().optional().describe("New price per unit"),
      unit: z.string().optional().describe("New unit of measure"),
      description: z.string().optional().describe("New description"),
      category: z.string().optional().describe("New category"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      data: z.object({
        id: z.string(),
        code: z.number(),
        name: z.string(),
        pricePerUnit: z.string(),
        unit: z.string(),
      }).optional(),
      error: z.string().optional(),
    }),

    execute: async ({ catalogId, itemId, name, pricePerUnit, unit, description, category }, context) => {
      const orgId = getAgentContextValue(context, "orgId");
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        const item = await catalogManager.updateItem(orgId, catalogId, itemId, {
          name,
          pricePerUnit,
          unit,
          description,
          category,
        });
        return {
          success: true,
          data: {
            id: item.id,
            code: item.code,
            name: item.name,
            pricePerUnit: item.pricePerUnit,
            unit: item.unit,
          },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
