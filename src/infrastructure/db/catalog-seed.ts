import { eq, and } from "drizzle-orm";
import { db } from "./client.js";
import { catalogs, catalogItems } from "./schema.js";

const CATALOG_ITEMS = [
  { code: 1, name: "Cesped verde",            pricePerUnit: "12.00", unit: "m²", sortOrder: 1 },
  { code: 2, name: "Cesped amarillo",          pricePerUnit: "13.00", unit: "m²", sortOrder: 2 },
  { code: 3, name: "Cesped premium",           pricePerUnit: "16.00", unit: "m²", sortOrder: 3 },
  { code: 4, name: "Cesped premium ultimate",  pricePerUnit: "18.00", unit: "m²", sortOrder: 4 },
  { code: 5, name: "Cesped v4",                pricePerUnit: "15.00", unit: "m²", sortOrder: 5 },
  { code: 6, name: "Cesped ecologico",         pricePerUnit: "16.00", unit: "m²", sortOrder: 6 },
  { code: 7, name: "Mano de obra",             pricePerUnit: "10.00", unit: "m²", sortOrder: 7 },
  { code: 8, name: "Desplazamiento",           pricePerUnit: "10.00", unit: "km", sortOrder: 8 },
];

/**
 * Seeds the product catalog for a given orgId.
 * Idempotent: skips if an active catalog already exists for the org.
 * Safe to call on every startup.
 */
export async function seedCatalog(orgId: string): Promise<void> {
  const [existing] = await db
    .select({ id: catalogs.id })
    .from(catalogs)
    .where(and(eq(catalogs.orgId, orgId), eq(catalogs.isActive, true)))
    .limit(1);

  if (existing) {
    console.log(`[seed:catalog] Active catalog already exists for org "${orgId}", skipping`);
    return;
  }

  const [catalog] = await db
    .insert(catalogs)
    .values({
      orgId,
      name: "Catálogo Césped Artificial 2026",
      effectiveDate: new Date("2026-01-01"),
      isActive: true,
    })
    .returning({ id: catalogs.id });

  await db.insert(catalogItems).values(
    CATALOG_ITEMS.map((item) => ({ ...item, catalogId: catalog!.id }))
  );

  console.log(`[seed:catalog] Created catalog "${catalog!.id}" with ${CATALOG_ITEMS.length} items for org "${orgId}"`);
}
