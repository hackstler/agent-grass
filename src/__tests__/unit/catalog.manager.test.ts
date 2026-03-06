import { describe, it, expect, beforeEach } from "vitest";
import { CatalogManager } from "../../application/managers/catalog.manager.js";
import { createMockCatalogRepo, fakeCatalog, fakeCatalogItem } from "../helpers/mock-repos.js";
import { NotFoundError } from "../../domain/errors/index.js";

describe("CatalogManager", () => {
  let repo: ReturnType<typeof createMockCatalogRepo>;
  let manager: CatalogManager;

  beforeEach(() => {
    repo = createMockCatalogRepo();
    manager = new CatalogManager(repo);
  });

  // ── listCatalogs ────────────────────────────────────────────────────────

  describe("listCatalogs(orgId)", () => {
    it("returns catalogs from repo", async () => {
      const catalogs = [fakeCatalog(), fakeCatalog({ id: "cat-2", name: "Second" })];
      repo.findByOrgId.mockResolvedValue(catalogs);

      const result = await manager.listCatalogs("org-1");

      expect(repo.findByOrgId).toHaveBeenCalledWith("org-1");
      expect(result).toEqual(catalogs);
    });
  });

  // ── getCatalog ──────────────────────────────────────────────────────────

  describe("getCatalog(orgId, catalogId)", () => {
    it("returns catalog when found", async () => {
      const catalog = fakeCatalog();
      repo.findByOrgAndId.mockResolvedValue(catalog);

      const result = await manager.getCatalog("org-1", "cat-1");

      expect(repo.findByOrgAndId).toHaveBeenCalledWith("org-1", "cat-1");
      expect(result).toEqual(catalog);
    });

    it("throws NotFoundError when not found", async () => {
      repo.findByOrgAndId.mockResolvedValue(null);

      await expect(manager.getCatalog("org-1", "cat-999")).rejects.toThrow(NotFoundError);
    });
  });

  // ── createCatalog ───────────────────────────────────────────────────────

  describe("createCatalog(orgId, dto)", () => {
    it("creates catalog with correct data", async () => {
      const catalog = fakeCatalog({ name: "New Catalog" });
      repo.create.mockResolvedValue(catalog);

      const result = await manager.createCatalog("org-1", {
        name: "New Catalog",
        effectiveDate: new Date("2025-06-01"),
      });

      expect(repo.create).toHaveBeenCalledWith({
        orgId: "org-1",
        name: "New Catalog",
        effectiveDate: new Date("2025-06-01"),
        isActive: undefined,
      });
      expect(result).toEqual(catalog);
    });
  });

  // ── updateCatalog ───────────────────────────────────────────────────────

  describe("updateCatalog(orgId, catalogId, dto)", () => {
    it("returns updated catalog when found", async () => {
      const updated = fakeCatalog({ name: "Renamed" });
      repo.update.mockResolvedValue(updated);

      const result = await manager.updateCatalog("org-1", "cat-1", { name: "Renamed" });

      expect(repo.update).toHaveBeenCalledWith("cat-1", "org-1", { name: "Renamed" });
      expect(result).toEqual(updated);
    });

    it("throws NotFoundError when repo.update returns null", async () => {
      repo.update.mockResolvedValue(null);

      await expect(manager.updateCatalog("org-1", "cat-999", { name: "X" })).rejects.toThrow(NotFoundError);
    });
  });

  // ── deleteCatalog ───────────────────────────────────────────────────────

  describe("deleteCatalog(orgId, catalogId)", () => {
    it("resolves when repo.delete returns true", async () => {
      repo.delete.mockResolvedValue(true);

      await expect(manager.deleteCatalog("org-1", "cat-1")).resolves.toBeUndefined();
    });

    it("throws NotFoundError when repo.delete returns false", async () => {
      repo.delete.mockResolvedValue(false);

      await expect(manager.deleteCatalog("org-1", "cat-999")).rejects.toThrow(NotFoundError);
    });
  });

  // ── activateCatalog ─────────────────────────────────────────────────────

  describe("activateCatalog(orgId, catalogId)", () => {
    it("deactivates other catalogs and activates the target", async () => {
      const cat1 = fakeCatalog({ id: "cat-1", isActive: true });
      const cat2 = fakeCatalog({ id: "cat-2", isActive: false });

      repo.findByOrgAndId.mockResolvedValue(cat1);
      repo.findByOrgId.mockResolvedValue([cat1, cat2]);
      repo.update.mockResolvedValue(fakeCatalog({ id: "cat-1", isActive: true }));

      await manager.activateCatalog("org-1", "cat-1");

      // Deactivated the active catalog
      expect(repo.update).toHaveBeenCalledWith("cat-1", "org-1", { isActive: false });
      // Activated the target
      expect(repo.update).toHaveBeenCalledWith("cat-1", "org-1", { isActive: true });
    });

    it("throws NotFoundError when catalog doesn't belong to org", async () => {
      repo.findByOrgAndId.mockResolvedValue(null);

      await expect(manager.activateCatalog("org-1", "cat-999")).rejects.toThrow(NotFoundError);
    });
  });

  // ── listItems ───────────────────────────────────────────────────────────

  describe("listItems(orgId, catalogId)", () => {
    it("returns items after verifying ownership", async () => {
      const catalog = fakeCatalog();
      const items = [fakeCatalogItem(), fakeCatalogItem({ id: "item-2", code: 2 })];
      repo.findByOrgAndId.mockResolvedValue(catalog);
      repo.findItemsByCatalog.mockResolvedValue(items);

      const result = await manager.listItems("org-1", "cat-1");

      expect(repo.findByOrgAndId).toHaveBeenCalledWith("org-1", "cat-1");
      expect(result).toEqual(items);
    });

    it("throws NotFoundError when catalog doesn't belong to org", async () => {
      repo.findByOrgAndId.mockResolvedValue(null);

      await expect(manager.listItems("org-1", "cat-999")).rejects.toThrow(NotFoundError);
    });
  });

  // ── createItem ──────────────────────────────────────────────────────────

  describe("createItem(orgId, catalogId, dto)", () => {
    it("auto-generates code when not provided", async () => {
      const catalog = fakeCatalog();
      const item = fakeCatalogItem({ code: 5 });
      repo.findByOrgAndId.mockResolvedValue(catalog);
      repo.nextCode.mockResolvedValue(5);
      repo.createItem.mockResolvedValue(item);

      const result = await manager.createItem("org-1", "cat-1", {
        name: "Product A",
        pricePerUnit: "10.00",
        unit: "m²",
      });

      expect(repo.nextCode).toHaveBeenCalledWith("cat-1");
      expect(repo.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ code: 5 }),
      );
      expect(result).toEqual(item);
    });

    it("uses provided code when given", async () => {
      const catalog = fakeCatalog();
      const item = fakeCatalogItem({ code: 42 });
      repo.findByOrgAndId.mockResolvedValue(catalog);
      repo.createItem.mockResolvedValue(item);

      await manager.createItem("org-1", "cat-1", {
        code: 42,
        name: "Product B",
        pricePerUnit: "20.00",
        unit: "m²",
      });

      expect(repo.nextCode).not.toHaveBeenCalled();
      expect(repo.createItem).toHaveBeenCalledWith(
        expect.objectContaining({ code: 42 }),
      );
    });
  });

  // ── deleteItem ──────────────────────────────────────────────────────────

  describe("deleteItem(orgId, catalogId, itemId)", () => {
    it("deletes item after verifying ownership", async () => {
      repo.findByOrgAndId.mockResolvedValue(fakeCatalog());
      repo.deleteItem.mockResolvedValue(true);

      await expect(manager.deleteItem("org-1", "cat-1", "item-1")).resolves.toBeUndefined();
    });

    it("throws NotFoundError when catalog doesn't belong to org", async () => {
      repo.findByOrgAndId.mockResolvedValue(null);

      await expect(manager.deleteItem("org-1", "cat-999", "item-1")).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError when item doesn't exist", async () => {
      repo.findByOrgAndId.mockResolvedValue(fakeCatalog());
      repo.deleteItem.mockResolvedValue(false);

      await expect(manager.deleteItem("org-1", "cat-1", "item-999")).rejects.toThrow(NotFoundError);
    });
  });
});
