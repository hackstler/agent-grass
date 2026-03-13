import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export function createCreateCatalogTool(catalogManager: CatalogManager) {
  return createTool({
    id: "createCatalog",
    description: "Create a new catalog for the organization.",

    inputSchema: z.object({
      name: z.string().describe("Catalog name"),
      effectiveDate: z.string().describe("Effective date in ISO format (e.g. 2026-01-01)"),
      isActive: z.boolean().optional().describe("Whether the catalog is active (default true)"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      data: z.object({
        id: z.string(),
        name: z.string(),
        effectiveDate: z.string(),
        isActive: z.boolean(),
      }).optional(),
      error: z.string().optional(),
    }),

    execute: async ({ name, effectiveDate, isActive }, context) => {
      const orgId = getAgentContextValue(context, "orgId");
      if (!orgId) return { success: false, error: "Missing orgId in request context" };

      try {
        const catalog = await catalogManager.createCatalog(orgId, {
          name,
          effectiveDate: new Date(effectiveDate),
          isActive,
        });
        return {
          success: true,
          data: {
            id: catalog.id,
            name: catalog.name,
            effectiveDate: catalog.effectiveDate.toISOString(),
            isActive: catalog.isActive,
          },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
