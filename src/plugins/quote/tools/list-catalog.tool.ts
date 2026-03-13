import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogService } from "../services/catalog.service.js";
import type { QuoteStrategy } from "../strategies/index.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface ListCatalogDeps {
  catalogService: CatalogService;
  strategy: QuoteStrategy;
}

export function createListCatalogTool({ catalogService, strategy }: ListCatalogDeps) {
  return createTool({
    id: "listCatalog",
    description: strategy.getListCatalogDescription(),

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
      const orgId = getAgentContextValue(context, "orgId");
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
        note: strategy.getListCatalogNote(),
      };
    },
  });
}
