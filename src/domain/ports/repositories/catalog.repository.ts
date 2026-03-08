import type { Catalog, NewCatalog, CatalogItem, NewCatalogItem } from "../../entities/index.js";

export interface CatalogRepository {
  // Catalogs
  findAll(): Promise<Catalog[]>;
  findByOrgId(orgId: string): Promise<Catalog[]>;
  findByOrgAndId(orgId: string, id: string): Promise<Catalog | null>;
  create(data: NewCatalog): Promise<Catalog>;
  update(
    id: string,
    orgId: string,
    data: Partial<Pick<Catalog, "name" | "effectiveDate" | "isActive">>,
  ): Promise<Catalog | null>;
  delete(id: string, orgId: string): Promise<boolean>;
  deleteByOrg(orgId: string): Promise<void>;

  // Items
  findItemsByCatalog(catalogId: string): Promise<CatalogItem[]>;
  findItemById(id: string): Promise<CatalogItem | null>;
  createItem(data: NewCatalogItem): Promise<CatalogItem>;
  updateItem(
    id: string,
    data: Partial<
      Pick<CatalogItem, "code" | "name" | "description" | "category" | "pricePerUnit" | "unit" | "sortOrder" | "isActive">
    >,
  ): Promise<CatalogItem | null>;
  deleteItem(id: string): Promise<boolean>;
  nextCode(catalogId: string): Promise<number>;
}
