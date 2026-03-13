import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export function createListCatalogItemsTool(catalogManager: CatalogManager) {
  return createTool({
    id: "listCatalogItems",
    description:
      "List all items in a specific catalog. Returns code, name, description, price, unit, and category. " +
      "Items with variable pricing (grass types) include a priceRange field with min/max prices per m² " +
      "for each surface type (SOLADO = concrete/tile, TIERRA = natural ground). " +
      "When priceRange is present, pricePerUnit is '0.00' — use priceRange instead.",

    inputSchema: z.object({
      catalogId: z.string().describe("The catalog ID to list items from"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      data: z.array(
        z.object({
          id: z.string(),
          code: z.number(),
          name: z.string(),
          description: z.string().nullable(),
          category: z.string().nullable(),
          pricePerUnit: z.string(),
          unit: z.string(),
          isActive: z.boolean(),
          priceRange: z.object({
            solado: z.object({ min: z.number(), max: z.number() }).optional(),
            tierra: z.object({ min: z.number(), max: z.number() }).optional(),
          }).optional(),
        })
      ).optional(),
      error: z.string().optional(),
    }),

    execute: async ({ catalogId }, context) => {
      const orgId = getAgentContextValue(context, "orgId");
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        const items = await catalogManager.listItems(orgId, catalogId);
        const priceRanges = await catalogManager.getItemPriceRanges(catalogId);
        return {
          success: true,
          data: items.map((i) => {
            const range = priceRanges.get(i.id);
            return {
              id: i.id,
              code: i.code,
              name: i.name,
              description: i.description,
              category: i.category,
              pricePerUnit: i.pricePerUnit,
              unit: i.unit,
              isActive: i.isActive,
              ...(range && { priceRange: range }),
            };
          }),
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
