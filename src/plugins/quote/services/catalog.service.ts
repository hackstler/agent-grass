import { eq, and, ilike, sql } from "drizzle-orm";
import { db } from "../../../infrastructure/db/client.js";
import { catalogs, catalogItems, grassPricing } from "../../../infrastructure/db/schema.js";
import { quoteConfig } from "../config/quote.config.js";

export interface CatalogItemResult {
  id: string;
  code: number;
  name: string;
  description: string | null;
  pricePerUnit: number;
  unit: string;
}

export interface GrassPriceResult {
  grassName: string;
  pricePerM2: number;
}

export interface ActiveCatalog {
  id: string;
  businessType: string;
  settings: Record<string, unknown> | null;
}

export class CatalogService {
  /**
   * Returns the ID and businessType of the single active catalog for the given org.
   * Falls back to any active catalog if the org has none (single-tenant convenience).
   */
  async getActiveCatalog(orgId: string): Promise<ActiveCatalog | null> {
    // Try org-specific first
    const [orgCatalog] = await db
      .select({ id: catalogs.id, businessType: catalogs.businessType, settings: catalogs.settings })
      .from(catalogs)
      .where(and(eq(catalogs.orgId, orgId), eq(catalogs.isActive, true)))
      .limit(1);

    if (orgCatalog) return orgCatalog;

    // Fallback: any active catalog (single-tenant deployments)
    const [fallbackCatalog] = await db
      .select({ id: catalogs.id, businessType: catalogs.businessType, settings: catalogs.settings })
      .from(catalogs)
      .where(eq(catalogs.isActive, true))
      .limit(1);

    return fallbackCatalog ?? null;
  }

  /**
   * @deprecated Use getActiveCatalog() instead — returns businessType too.
   * Kept for backward compatibility with listCatalog tool.
   */
  async getActiveCatalogId(orgId: string): Promise<string | null> {
    const catalog = await this.getActiveCatalog(orgId);
    return catalog?.id ?? null;
  }

  /**
   * Finds a catalog item by code (numeric string) or partial name (case+accent insensitive).
   */
  async findItem(catalogId: string, nameOrCode: string): Promise<CatalogItemResult | null> {
    const trimmed = nameOrCode.trim();
    const isNumeric = /^\d+$/.test(trimmed);

    // Strip accents for accent-insensitive matching
    const normalize = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const [item] = await db
      .select({
        id: catalogItems.id,
        code: catalogItems.code,
        name: catalogItems.name,
        description: catalogItems.description,
        pricePerUnit: catalogItems.pricePerUnit,
        unit: catalogItems.unit,
      })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.catalogId, catalogId),
          eq(catalogItems.isActive, true),
          isNumeric
            ? eq(catalogItems.code, parseInt(trimmed, 10))
            : sql`lower(translate(${catalogItems.name}, 'áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙäëïöüÄËÏÖÜñÑ', 'aeiouAEIOUaeiouAEIOUaeiouAEIOUnN')) like lower(${`%${normalize(trimmed).replace(/%/g, "\\%").replace(/_/g, "\\_")}%`})`
        )
      )
      .limit(1);

    if (!item) return null;

    return {
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description ?? null,
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
        description: catalogItems.description,
        pricePerUnit: catalogItems.pricePerUnit,
        unit: catalogItems.unit,
      })
      .from(catalogItems)
      .where(and(eq(catalogItems.catalogId, catalogId), eq(catalogItems.isActive, true)))
      .orderBy(catalogItems.sortOrder);

    return rows.map((r) => ({
      ...r,
      description: r.description ?? null,
      pricePerUnit: parseFloat(String(r.pricePerUnit)),
    }));
  }

  /**
   * Returns the S+I price per m² for all grass types at a given (surfaceType, areaM2).
   * Uses ceil(areaM2) clamped to maxM2Lookup for the lookup.
   */
  async getAllGrassPrices(
    catalogId: string,
    surfaceType: "SOLADO" | "TIERRA",
    areaM2: number,
  ): Promise<GrassPriceResult[]> {
    const lookupM2 = Math.min(Math.ceil(areaM2), quoteConfig.maxM2Lookup);

    const rows = await db
      .select({
        grassName: catalogItems.name,
        pricePerM2: grassPricing.pricePerM2,
      })
      .from(grassPricing)
      .innerJoin(catalogItems, eq(grassPricing.catalogItemId, catalogItems.id))
      .where(
        and(
          eq(catalogItems.catalogId, catalogId),
          eq(catalogItems.isActive, true),
          eq(grassPricing.surfaceType, surfaceType),
          eq(grassPricing.m2, lookupM2),
        )
      )
      .orderBy(catalogItems.sortOrder);

    return rows.map((r) => ({
      grassName: r.grassName,
      pricePerM2: parseFloat(String(r.pricePerM2)),
    }));
  }
}
