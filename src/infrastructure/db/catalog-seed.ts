import { eq, and, sql } from "drizzle-orm";
import { db } from "./client.js";
import { catalogs, catalogItems, grassPricing } from "./schema.js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface GrassTypeEntry {
  name: string;
  code: number;
  description: string;
  sortOrder: number;
}

interface PricingEntry {
  grassName: string;
  surfaceType: "SOLADO" | "TIERRA";
  m2: number;
  pricePerM2: number;
}

interface PricingData {
  grassTypes: GrassTypeEntry[];
  pricing: PricingEntry[];
}

function loadPricingData(): PricingData {
  const filePath = resolve(__dirname, "grass-pricing-data.json");
  return JSON.parse(readFileSync(filePath, "utf-8")) as PricingData;
}

/**
 * Seeds the product catalog and grass pricing for a given orgId.
 * Idempotent: skips if an active catalog with grass_pricing rows already exists.
 * Safe to call on every startup.
 */
export async function seedCatalog(orgId: string): Promise<void> {
  // Check if we already have a catalog with grass_pricing data
  const [existing] = await db
    .select({ id: catalogs.id })
    .from(catalogs)
    .where(and(eq(catalogs.orgId, orgId), eq(catalogs.isActive, true)))
    .limit(1);

  if (existing) {
    // Check if grass_pricing already has rows for this catalog's items
    const [pricingCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(grassPricing)
      .innerJoin(catalogItems, eq(grassPricing.catalogItemId, catalogItems.id))
      .where(eq(catalogItems.catalogId, existing.id));

    if (pricingCount && pricingCount.count > 0) {
      console.log(`[seed:catalog] Active catalog with ${pricingCount.count} grass_pricing rows for org "${orgId}", skipping`);
      return;
    }

    // Catalog exists but no pricing → delete old catalog and recreate
    console.log(`[seed:catalog] Deleting old catalog without pricing for org "${orgId}"`);
    await db.delete(catalogs).where(eq(catalogs.id, existing.id));
  }

  const data = loadPricingData();

  // Create catalog
  const [catalog] = await db
    .insert(catalogs)
    .values({
      orgId,
      name: "Madrid Césped 2025",
      effectiveDate: new Date("2025-01-01"),
      isActive: true,
    })
    .returning({ id: catalogs.id });

  const catalogId = catalog!.id;

  // Create catalog items (8 grass types)
  const itemRows = data.grassTypes.map((g) => ({
    catalogId,
    code: g.code,
    name: g.name,
    description: g.description,
    category: "césped artificial",
    pricePerUnit: "0.00", // real pricing in grass_pricing table
    unit: "m²",
    sortOrder: g.sortOrder,
  }));

  const insertedItems = await db
    .insert(catalogItems)
    .values(itemRows)
    .returning({ id: catalogItems.id, name: catalogItems.name });

  // Build name→id map for linking pricing
  const nameToId = new Map<string, string>();
  for (const item of insertedItems) {
    nameToId.set(item.name, item.id);
  }

  // Insert grass_pricing in batches (10,400 rows)
  const BATCH_SIZE = 500;
  const pricingRows = data.pricing.map((p) => ({
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

  console.log(
    `[seed:catalog] Created catalog "${catalogId}" with ${insertedItems.length} grass types and ${inserted} pricing rows for org "${orgId}"`
  );
}
