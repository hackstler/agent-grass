import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export function createListCatalogsTool(catalogManager: CatalogManager) {
  return createTool({
    id: "listCatalogs",
    description:
      "List all catalogs for the organization. Returns id, name, effective date, and active status.",

    inputSchema: z.object({}),

    outputSchema: z.object({
      success: z.boolean(),
      data: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          effectiveDate: z.string(),
          isActive: z.boolean(),
        })
      ).optional(),
      error: z.string().optional(),
    }),

    execute: async (_input, context) => {
      const orgId = getAgentContextValue(context, "orgId");
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        const catalogs = await catalogManager.listCatalogs(orgId);
        return {
          success: true,
          data: catalogs.map((c) => ({
            id: c.id,
            name: c.name,
            effectiveDate: c.effectiveDate.toISOString(),
            isActive: c.isActive,
          })),
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
