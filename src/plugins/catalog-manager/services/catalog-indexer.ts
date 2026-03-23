import { createHash } from "node:crypto";
import type { Catalog, CatalogItem } from "../../../domain/entities/index.js";
import type { CatalogRepository } from "../../../domain/ports/repositories/catalog.repository.js";
import type { LoadedDocument } from "../../rag/ingestion/loader.js";
import type { ProcessResult } from "../../rag/ingestion/processor.js";
import { processDocument } from "../../rag/ingestion/processor.js";
import { db } from "../../../infrastructure/db/client.js";
import { documents, grassPricing, catalogItems as catalogItemsTable } from "../../../infrastructure/db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import type { EntityIndexer } from "./entity-indexer.js";
import { logger } from "../../../shared/logger.js";

interface PriceRange {
  min: number;
  max: number;
}

interface ItemPriceRanges {
  solado: PriceRange | null;
  tierra: PriceRange | null;
}

interface CatalogWithItems extends Catalog {
  items: CatalogItem[];
}

export class CatalogIndexer implements EntityIndexer<CatalogWithItems> {
  readonly entityType = "catalog";

  constructor(private readonly catalogRepo: CatalogRepository) {}

  buildSource(catalogId: string): string {
    return `entity://catalog/${catalogId}`;
  }

  /**
   * Query grass_pricing to get min/max price per m² for each item, grouped by surface type.
   */
  private async getPriceRanges(catalogId: string): Promise<Map<string, ItemPriceRanges>> {
    const rows = await db
      .select({
        itemId: catalogItemsTable.id,
        surfaceType: grassPricing.surfaceType,
        minPrice: sql<string>`min(${grassPricing.pricePerM2})`,
        maxPrice: sql<string>`max(${grassPricing.pricePerM2})`,
      })
      .from(grassPricing)
      .innerJoin(catalogItemsTable, eq(grassPricing.catalogItemId, catalogItemsTable.id))
      .where(and(eq(catalogItemsTable.catalogId, catalogId), eq(catalogItemsTable.isActive, true)))
      .groupBy(catalogItemsTable.id, grassPricing.surfaceType);

    const map = new Map<string, ItemPriceRanges>();
    for (const row of rows) {
      const existing = map.get(row.itemId) ?? { solado: null, tierra: null };
      const range: PriceRange = { min: parseFloat(row.minPrice), max: parseFloat(row.maxPrice) };
      if (row.surfaceType === "SOLADO") existing.solado = range;
      else if (row.surfaceType === "TIERRA") existing.tierra = range;
      map.set(row.itemId, existing);
    }
    return map;
  }

  private formatRange(range: PriceRange | null): string {
    if (!range) return "—";
    if (range.min === range.max) return `${range.min.toFixed(2)} €/m²`;
    return `${range.min.toFixed(2)} – ${range.max.toFixed(2)} €/m²`;
  }

  async toDocument(catalog: CatalogWithItems, _orgId: string): Promise<LoadedDocument> {
    const lines: string[] = [];

    lines.push(`# Catalogo: ${catalog.name}`);
    lines.push("");
    lines.push(`- **Fecha efectiva**: ${catalog.effectiveDate.toLocaleDateString("es-ES")}`);
    lines.push(`- **Estado**: ${catalog.isActive ? "Activo" : "Inactivo"}`);
    lines.push(`- **Total productos**: ${catalog.items.length}`);
    lines.push("");

    // Get real pricing from grass_pricing table
    const priceRanges = await this.getPriceRanges(catalog.id);
    const hasPricing = priceRanges.size > 0;

    // Group items by category
    const byCategory = new Map<string, CatalogItem[]>();
    for (const item of catalog.items) {
      const cat = item.category ?? "Sin categoria";
      const list = byCategory.get(cat) ?? [];
      list.push(item);
      byCategory.set(cat, list);
    }

    for (const [category, items] of byCategory) {
      lines.push(`## ${category}`);
      lines.push("");

      if (hasPricing) {
        // Show price ranges per surface type (real data from grass_pricing)
        lines.push("| Codigo | Nombre | SOLADO (€/m²) | TIERRA (€/m²) |");
        lines.push("|--------|--------|---------------|---------------|");
        for (const item of items) {
          const ranges = priceRanges.get(item.id);
          lines.push(
            `| ${item.code} | ${item.name} | ${this.formatRange(ranges?.solado ?? null)} | ${this.formatRange(ranges?.tierra ?? null)} |`
          );
        }
      } else {
        // Fallback: show basic item info without pricing
        lines.push("| Codigo | Nombre | Descripcion | Precio | Unidad |");
        lines.push("|--------|--------|-------------|--------|--------|");
        for (const item of items) {
          const desc = item.description?.replace(/\|/g, "/") ?? "";
          lines.push(
            `| ${item.code} | ${item.name} | ${desc} | ${item.pricePerUnit} | ${item.unit} |`
          );
        }
      }
      lines.push("");
    }

    if (hasPricing) {
      lines.push("---");
      lines.push("");
      lines.push("**IMPORTANTE sobre precios**: Los precios varian segun el tipo de suelo (SOLADO = hormigon/baldosa, TIERRA = terreno natural) y la superficie en metros cuadrados. A mayor superficie, menor precio por m². Los rangos mostrados van desde el precio mas barato (superficies grandes, ~650 m²) hasta el mas caro (superficies pequenas, ~1 m²). Para calcular un presupuesto exacto para un cliente, utilizar SIEMPRE la herramienta calculateBudget con los m² y tipo de suelo concretos.");
      lines.push("");
    }

    const content = lines.join("\n");

    return {
      content,
      metadata: {
        title: `Catalogo: ${catalog.name}`,
        source: this.buildSource(catalog.id),
        contentType: "entity",
        size: Buffer.byteLength(content, "utf-8"),
      },
    };
  }

  private contentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  async index(orgId: string, catalogId: string): Promise<ProcessResult | null> {
    const catalog = await this.catalogRepo.findByOrgAndId(orgId, catalogId);
    if (!catalog) {
      logger.warn({ catalogId, orgId }, "Catalog not found for org");
      return null;
    }

    // Only index active catalogs
    if (!catalog.isActive) {
      await this.remove(catalogId);
      return null;
    }

    const items = await this.catalogRepo.findItemsByCatalog(catalogId);
    const catalogWithItems: CatalogWithItems = { ...catalog, items };
    const loaded = await this.toDocument(catalogWithItems, orgId);

    // Skip if content hasn't changed (compare hash stored in metadata)
    const hash = this.contentHash(loaded.content);
    const source = this.buildSource(catalogId);
    const existing = await db.query.documents.findFirst({
      where: eq(documents.source, source),
      columns: { id: true, metadata: true },
    });

    if (existing) {
      const existingHash = (existing.metadata as Record<string, unknown> | null)?.["contentHash"];
      if (existingHash === hash) {
        logger.info({ catalogName: catalog.name }, "Skipping catalog — content unchanged");
        return { documentId: existing.id, chunkCount: 0, status: "indexed", skipped: true };
      }
    }

    // Store hash in metadata for future comparisons
    loaded.metadata = { ...loaded.metadata, contentHash: hash } as typeof loaded.metadata;

    logger.info({ catalogName: catalog.name, itemCount: items.length, hash }, "Indexing catalog");
    return processDocument(loaded, orgId);
  }

  async remove(catalogId: string): Promise<void> {
    const source = this.buildSource(catalogId);
    const existing = await db.query.documents.findFirst({
      where: eq(documents.source, source),
      columns: { id: true },
    });
    if (existing) {
      await db.delete(documents).where(eq(documents.id, existing.id));
      logger.info({ catalogId }, "Removed catalog index");
    }
  }

  async indexAll(orgId: string): Promise<{ indexed: number; failed: number }> {
    const catalogs = await this.catalogRepo.findByOrgId(orgId);
    let indexed = 0;
    let failed = 0;

    for (const catalog of catalogs) {
      if (!catalog.isActive) continue;
      try {
        const result = await this.index(orgId, catalog.id);
        if (result?.status === "indexed") indexed++;
        else if (result?.status === "failed") failed++;
      } catch (err) {
        logger.error({ err, catalogId: catalog.id }, "Failed to index catalog");
        failed++;
      }
    }

    return { indexed, failed };
  }

  async indexAllOrgs(): Promise<{ indexed: number; failed: number }> {
    const allCatalogs = await this.catalogRepo.findAll();

    // Collect unique orgIds
    const orgIds = [...new Set(allCatalogs.map((c) => c.orgId))];
    let totalIndexed = 0;
    let totalFailed = 0;

    for (const orgId of orgIds) {
      const { indexed, failed } = await this.indexAll(orgId);
      totalIndexed += indexed;
      totalFailed += failed;
    }

    return { indexed: totalIndexed, failed: totalFailed };
  }
}
