import type { Catalog, CatalogItem } from "../../domain/entities/index.js";
import type { CatalogRepository } from "../../domain/ports/repositories/catalog.repository.js";
import { NotFoundError } from "../../domain/errors/index.js";
import { entityEvents, type EntityEventType } from "../events/entity-events.js";

export interface CreateCatalogDto {
  name: string;
  effectiveDate: Date;
  isActive?: boolean | undefined;
}

export interface UpdateCatalogDto {
  name?: string | undefined;
  effectiveDate?: Date | undefined;
  isActive?: boolean | undefined;
}

export interface CreateItemDto {
  code?: number | undefined;
  name: string;
  description?: string | null | undefined;
  category?: string | null | undefined;
  pricePerUnit: string;
  unit: string;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}

export interface UpdateItemDto {
  code?: number | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  category?: string | null | undefined;
  pricePerUnit?: string | undefined;
  unit?: string | undefined;
  sortOrder?: number | undefined;
  isActive?: boolean | undefined;
}

export class CatalogManager {
  constructor(private readonly repo: CatalogRepository) {}

  private emitEvent(type: EntityEventType, orgId: string, entityId: string, relatedId?: string): void {
    try {
      const event = { type, orgId, entityId, timestamp: new Date(), ...(relatedId != null && { relatedId }) };
      entityEvents.emit("entity", event);
    } catch {
      // fire-and-forget: listener errors must not break CRUD
    }
  }

  // ── Catalogs ──────────────────────────────────────────────────────────────

  async listCatalogs(orgId: string): Promise<Catalog[]> {
    return this.repo.findByOrgId(orgId);
  }

  async listAllCatalogs(): Promise<Catalog[]> {
    return this.repo.findAll();
  }

  async getCatalog(orgId: string, catalogId: string): Promise<Catalog> {
    const catalog = await this.repo.findByOrgAndId(orgId, catalogId);
    if (!catalog) throw new NotFoundError("Catalog", catalogId);
    return catalog;
  }

  /** Look up catalog by ID only (no org scoping). Used by super_admin flows. */
  async getCatalogById(catalogId: string): Promise<Catalog> {
    const catalog = await this.repo.findById(catalogId);
    if (!catalog) throw new NotFoundError("Catalog", catalogId);
    return catalog;
  }

  async createCatalog(orgId: string, dto: CreateCatalogDto): Promise<Catalog> {
    const catalog = await this.repo.create({
      orgId,
      name: dto.name,
      effectiveDate: dto.effectiveDate,
      isActive: dto.isActive,
    });
    this.emitEvent("catalog:created", orgId, catalog.id);
    return catalog;
  }

  async updateCatalog(orgId: string, catalogId: string, dto: UpdateCatalogDto): Promise<Catalog> {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data["name"] = dto.name;
    if (dto.effectiveDate !== undefined) data["effectiveDate"] = dto.effectiveDate;
    if (dto.isActive !== undefined) data["isActive"] = dto.isActive;

    const updated = await this.repo.update(
      catalogId,
      orgId,
      data as Parameters<typeof this.repo.update>[2],
    );
    if (!updated) throw new NotFoundError("Catalog", catalogId);
    this.emitEvent("catalog:updated", orgId, catalogId);
    return updated;
  }

  async deleteCatalog(orgId: string, catalogId: string): Promise<void> {
    const deleted = await this.repo.delete(catalogId, orgId);
    if (!deleted) throw new NotFoundError("Catalog", catalogId);
    this.emitEvent("catalog:deleted", orgId, catalogId);
  }

  async activateCatalog(orgId: string, catalogId: string): Promise<Catalog> {
    // Verify catalog exists and belongs to org
    const catalog = await this.getCatalog(orgId, catalogId);

    // Deactivate all org catalogs
    const allCatalogs = await this.repo.findByOrgId(orgId);
    for (const c of allCatalogs) {
      if (c.isActive) {
        await this.repo.update(c.id, orgId, { isActive: false });
      }
    }

    // Activate the target
    const activated = await this.repo.update(catalog.id, orgId, { isActive: true });
    this.emitEvent("catalog:activated", orgId, catalogId);
    return activated!;
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  async listItems(orgId: string, catalogId: string): Promise<CatalogItem[]> {
    await this.getCatalog(orgId, catalogId); // verify ownership
    return this.repo.findItemsByCatalog(catalogId);
  }

  async createItem(orgId: string, catalogId: string, dto: CreateItemDto): Promise<CatalogItem> {
    await this.getCatalog(orgId, catalogId); // verify ownership

    const code = dto.code ?? (await this.repo.nextCode(catalogId));

    const item = await this.repo.createItem({
      catalogId,
      code,
      name: dto.name,
      description: dto.description,
      category: dto.category,
      pricePerUnit: dto.pricePerUnit,
      unit: dto.unit,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
    });
    this.emitEvent("catalog:item:created", orgId, item.id, catalogId);
    return item;
  }

  async updateItem(
    orgId: string,
    catalogId: string,
    itemId: string,
    dto: UpdateItemDto,
  ): Promise<CatalogItem> {
    await this.getCatalog(orgId, catalogId); // verify ownership

    const data: Record<string, unknown> = {};
    if (dto.code !== undefined) data["code"] = dto.code;
    if (dto.name !== undefined) data["name"] = dto.name;
    if (dto.description !== undefined) data["description"] = dto.description;
    if (dto.category !== undefined) data["category"] = dto.category;
    if (dto.pricePerUnit !== undefined) data["pricePerUnit"] = dto.pricePerUnit;
    if (dto.unit !== undefined) data["unit"] = dto.unit;
    if (dto.sortOrder !== undefined) data["sortOrder"] = dto.sortOrder;
    if (dto.isActive !== undefined) data["isActive"] = dto.isActive;

    const updated = await this.repo.updateItem(
      itemId,
      data as Parameters<typeof this.repo.updateItem>[1],
    );
    if (!updated) throw new NotFoundError("CatalogItem", itemId);
    this.emitEvent("catalog:item:updated", orgId, itemId, catalogId);
    return updated;
  }

  async deleteItem(orgId: string, catalogId: string, itemId: string): Promise<void> {
    await this.getCatalog(orgId, catalogId); // verify ownership
    const deleted = await this.repo.deleteItem(itemId);
    if (!deleted) throw new NotFoundError("CatalogItem", itemId);
    this.emitEvent("catalog:item:deleted", orgId, itemId, catalogId);
  }

  async getItemPriceRanges(catalogId: string): Promise<Map<string, {
    solado?: { min: number; max: number };
    tierra?: { min: number; max: number };
  }>> {
    return this.repo.getItemPriceRanges(catalogId);
  }

  async importPricing(
    orgId: string,
    catalogId: string,
    items: { name: string; code: number; description: string; category: string; unit: string; sortOrder: number }[],
    pricing: { grassName: string; surfaceType: string; m2: number; pricePerM2: number }[],
  ): Promise<{ itemsCreated: number; pricingRows: number }> {
    await this.getCatalog(orgId, catalogId); // verify ownership
    const result = await this.repo.bulkImportPricing(catalogId, items, pricing);
    this.emitEvent("catalog:updated", orgId, catalogId);
    return result;
  }
}
