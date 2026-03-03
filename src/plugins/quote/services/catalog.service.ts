import { eq, and, ilike, sql } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client.js";
import { catalogs, catalogItems } from "../../../infrastructure/db/schema.js";

export interface CatalogItemResult {
  id: string;
  code: number;
  name: string;
  pricePerUnit: number;
  unit: string;
}

export class CatalogService {
  /**
   * Returns the ID of the single active catalog for the given org.
   * Falls back to any active catalog if the org has none (single-tenant convenience).
   */
  async getActiveCatalogId(orgId: string): Promise<string | null> {
    // Try org-specific first
    const [orgCatalog] = await db
      .select({ id: catalogs.id })
      .from(catalogs)
      .where(and(eq(catalogs.orgId, orgId), eq(catalogs.isActive, true)))
      .limit(1);

    if (orgCatalog) return orgCatalog.id;

    // Fallback: any active catalog (single-tenant deployments)
    const [fallbackCatalog] = await db
      .select({ id: catalogs.id })
      .from(catalogs)
      .where(eq(catalogs.isActive, true))
      .limit(1);

    return fallbackCatalog?.id ?? null;
  }

  /**
   * Finds a catalog item by code (numeric string) or partial name (case-insensitive).
   */
  async findItem(catalogId: string, nameOrCode: string): Promise<CatalogItemResult | null> {
    const trimmed = nameOrCode.trim();
    const isNumeric = /^\d+$/.test(trimmed);

    const [item] = await db
      .select({
        id: catalogItems.id,
        code: catalogItems.code,
        name: catalogItems.name,
        pricePerUnit: catalogItems.pricePerUnit,
        unit: catalogItems.unit,
      })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.catalogId, catalogId),
          isNumeric
            ? eq(catalogItems.code, parseInt(trimmed, 10))
            : ilike(catalogItems.name, `%${trimmed.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`)
        )
      )
      .limit(1);

    if (!item) return null;

    return {
      id: item.id,
      code: item.code,
      name: item.name,
      pricePerUnit: parseFloat(String(item.pricePerUnit)),
      unit: item.unit,
    };
  }

  /**
   * Returns all items in a catalog ordered by sort_order.
   */
  async getAllItems(catalogId: string): Promise<CatalogItemResult[]> {
    const rows = await db
      .select({
        id: catalogItems.id,
        code: catalogItems.code,
        name: catalogItems.name,
        pricePerUnit: catalogItems.pricePerUnit,
        unit: catalogItems.unit,
      })
      .from(catalogItems)
      .where(eq(catalogItems.catalogId, catalogId))
      .orderBy(catalogItems.sortOrder);

    return rows.map((r) => ({
      ...r,
      pricePerUnit: parseFloat(String(r.pricePerUnit)),
    }));
  }
}
