import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogService } from "../services/catalog.service.js";

export interface ListCatalogDeps {
  catalogService: CatalogService;
}

export function createListCatalogTool({ catalogService }: ListCatalogDeps) {
  return createTool({
    id: "listCatalog",
    description: `List the available grass types in the organization's catalog.
Returns grass type names and descriptions. Pricing varies by surface type and m² — use calculateBudget for actual prices.`,

    inputSchema: z.object({}),

    outputSchema: z.object({
      success: z.boolean(),
      catalogName: z.string(),
      grassTypes: z.array(z.object({
        code: z.number(),
        name: z.string(),
        description: z.string().nullable(),
        unit: z.string(),
      })),
      note: z.string(),
      error: z.string().optional(),
    }),

    execute: async (_input, context) => {
      const orgId = context?.requestContext?.get("orgId") as string | undefined;
      if (!orgId) {
        return {
          success: false,
          catalogName: "",
          grassTypes: [],
          note: "",
          error: "Missing orgId in request context",
        };
      }

      const catalogId = await catalogService.getActiveCatalogId(orgId);
      if (!catalogId) {
        return {
          success: false,
          catalogName: "",
          grassTypes: [],
          note: "",
          error: "No active catalog found for this organization",
        };
      }

      const items = await catalogService.getAllItems(catalogId);

      return {
        success: true,
        catalogName: orgId,
        grassTypes: items.map((i) => ({
          code: i.code,
          name: i.name,
          description: i.description,
          unit: i.unit,
        })),
        note: "El pricing varía según tipo de superficie (SOLADO/TIERRA) y m². Usa calculateBudget para precios exactos.",
      };
    },
  });
}
