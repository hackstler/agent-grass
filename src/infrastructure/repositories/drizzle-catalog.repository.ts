import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { catalogs, catalogItems, grassPricing } from "../db/schema.js";
import type { Catalog, NewCatalog, CatalogItem, NewCatalogItem } from "../db/schema.js";
import type { CatalogRepository } from "../../domain/ports/repositories/catalog.repository.js";
import { ConflictError } from "../../domain/errors/index.js";

export class DrizzleCatalogRepository implements CatalogRepository {
  // ── Catalogs ──────────────────────────────────────────────────────────────

  async findAll(): Promise<Catalog[]> {
    return db
      .select()
      .from(catalogs)
      .orderBy(desc(catalogs.createdAt));
  }

  async findById(id: string): Promise<Catalog | null> {
    const result = await db.query.catalogs.findFirst({
      where: eq(catalogs.id, id),
    });
    return result ?? null;
  }

  async findByOrgId(orgId: string): Promise<Catalog[]> {
    return db
      .select()
      .from(catalogs)
      .where(eq(catalogs.orgId, orgId))
      .orderBy(desc(catalogs.createdAt));
  }

  async findByOrgAndId(orgId: string, id: string): Promise<Catalog | null> {
    const result = await db.query.catalogs.findFirst({
      where: and(eq(catalogs.id, id), eq(catalogs.orgId, orgId)),
    });
    return result ?? null;
  }

  async create(data: NewCatalog): Promise<Catalog> {
    const [catalog] = await db.insert(catalogs).values(data).returning();
    return catalog!;
  }

  async update(
    id: string,
    orgId: string,
    data: Partial<Pick<Catalog, "name" | "effectiveDate" | "isActive">>,
  ): Promise<Catalog | null> {
    const [updated] = await db
      .update(catalogs)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(catalogs.id, id), eq(catalogs.orgId, orgId)))
      .returning();
    return updated ?? null;
  }

  async delete(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(catalogs)
      .where(and(eq(catalogs.id, id), eq(catalogs.orgId, orgId)))
      .returning({ id: catalogs.id });
    return result.length > 0;
  }

  async deleteByOrg(orgId: string): Promise<void> {
    await db.delete(catalogs).where(eq(catalogs.orgId, orgId));
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  async findItemsByCatalog(catalogId: string): Promise<CatalogItem[]> {
    return db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.catalogId, catalogId))
      .orderBy(catalogItems.sortOrder, catalogItems.code);
  }

  async findItemById(id: string): Promise<CatalogItem | null> {
    const result = await db.query.catalogItems.findFirst({
      where: eq(catalogItems.id, id),
    });
    return result ?? null;
  }

  async createItem(data: NewCatalogItem): Promise<CatalogItem> {
    try {
      const [item] = await db.insert(catalogItems).values(data).returning();
      return item!;
    } catch (err: unknown) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === "23505") {
        throw new ConflictError("CatalogItem", `code '${data.code}'`);
      }
      throw err;
    }
  }

  async updateItem(
    id: string,
    data: Partial<
      Pick<CatalogItem, "code" | "name" | "description" | "category" | "pricePerUnit" | "unit" | "sortOrder" | "isActive">
    >,
  ): Promise<CatalogItem | null> {
    try {
      const [updated] = await db
        .update(catalogItems)
        .set(data)
        .where(eq(catalogItems.id, id))
        .returning();
      return updated ?? null;
    } catch (err: unknown) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === "23505") {
        throw new ConflictError("CatalogItem", `code '${data.code}'`);
      }
      throw err;
    }
  }

  async deleteItem(id: string): Promise<boolean> {
    const result = await db
      .delete(catalogItems)
      .where(eq(catalogItems.id, id))
      .returning({ id: catalogItems.id });
    return result.length > 0;
  }

  async nextCode(catalogId: string): Promise<number> {
    const [row] = await db
      .select({ maxCode: sql<number>`coalesce(max(${catalogItems.code}), 0)` })
      .from(catalogItems)
      .where(eq(catalogItems.catalogId, catalogId));
    return (row?.maxCode ?? 0) + 1;
  }

  async bulkImportPricing(
    catalogId: string,
    items: { name: string; code: number; description: string; category: string; unit: string; sortOrder: number }[],
    pricing: { grassName: string; surfaceType: string; m2: number; pricePerM2: number }[],
  ): Promise<{ itemsCreated: number; pricingRows: number }> {
    // 1. Delete existing pricing for this catalog's items
    const existingItems = await db
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(eq(catalogItems.catalogId, catalogId));

    if (existingItems.length > 0) {
      const existingIds = existingItems.map((i) => i.id);
      await db.delete(grassPricing).where(inArray(grassPricing.catalogItemId, existingIds));
      await db.delete(catalogItems).where(eq(catalogItems.catalogId, catalogId));
    }

    // 2. Create catalog items
    const itemRows = items.map((g) => ({
      catalogId,
      code: g.code,
      name: g.name,
      description: g.description,
      category: g.category,
      pricePerUnit: "0.00",
      unit: g.unit,
      sortOrder: g.sortOrder,
    }));

    const insertedItems = await db
      .insert(catalogItems)
      .values(itemRows)
      .returning({ id: catalogItems.id, name: catalogItems.name });

    // 3. Build name→id map
    const nameToId = new Map<string, string>();
    for (const item of insertedItems) {
      nameToId.set(item.name, item.id);
    }

    // 4. Bulk insert pricing in batches
    const BATCH_SIZE = 500;
    const pricingRows = pricing
      .filter((p) => nameToId.has(p.grassName))
      .map((p) => ({
        catalogItemId: nameToId.get(p.grassName)!,
        surfaceType: p.surfaceType,
        m2: p.m2,
        pricePerM2: String(p.pricePerM2),
      }));

    let inserted = 0;
    for (let i = 0; i < pricingRows.length; i += BATCH_SIZE) {
      const batch = pricingRows.slice(i, i + BATCH_SIZE);
      await db.insert(grassPricing).values(batch);
      inserted += batch.length;
    }

    return { itemsCreated: insertedItems.length, pricingRows: inserted };
  }
}
