import { Hono } from "hono";
import { z } from "zod";
import type { CatalogManager } from "../../application/managers/catalog.manager.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";

const createCatalogValidator = z.object({
  name: z.string().min(1).max(200),
  effectiveDate: z.string().datetime(),
  isActive: z.boolean().optional(),
});

const updateCatalogValidator = z.object({
  name: z.string().min(1).max(200).optional(),
  effectiveDate: z.string().datetime().optional(),
  isActive: z.boolean().optional(),
});

const createItemValidator = z.object({
  code: z.number().int().positive().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  pricePerUnit: z.number().positive(),
  unit: z.string().min(1).max(50),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

const updateItemValidator = z.object({
  code: z.number().int().positive().optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  pricePerUnit: z.number().positive().optional(),
  unit: z.string().min(1).max(50).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export function createCatalogController(manager: CatalogManager, orgRepo?: OrganizationRepository): Hono {
  const router = new Hono();

  // ── Catalogs ──────────────────────────────────────────────────────────────

  router.get("/", async (c) => {
    const user = c.get("user");
    const orgId = user?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    // Super admin sees all catalogs with org names
    if (user?.role === "super_admin") {
      const rows = await manager.listAllCatalogs();

      // Resolve org names
      const uniqueOrgIds = [...new Set(rows.map((r) => r.orgId))];
      const orgNameMap = new Map<string, string | null>();
      if (orgRepo) {
        await Promise.all(
          uniqueOrgIds.map(async (oid) => {
            const org = await orgRepo.findByOrgId(oid);
            orgNameMap.set(oid, org?.name ?? null);
          }),
        );
      }

      const enriched = rows.map((r) => ({ ...r, orgName: orgNameMap.get(r.orgId) ?? null }));
      return c.json({ items: enriched, total: enriched.length });
    }

    const rows = await manager.listCatalogs(orgId);
    return c.json({ items: rows, total: rows.length });
  });

  router.post("/", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = createCatalogValidator.safeParse(body);
    if (!parsed.success) return c.json({ error: "Validation", message: parsed.error.message }, 400);

    const catalog = await manager.createCatalog(orgId, {
      name: parsed.data.name,
      effectiveDate: new Date(parsed.data.effectiveDate),
      isActive: parsed.data.isActive,
    });
    return c.json(catalog, 201);
  });

  router.get("/:catalogId", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);
    const catalogId = c.req.param("catalogId");
    const catalog = await manager.getCatalog(orgId, catalogId);
    return c.json(catalog);
  });

  router.patch("/:catalogId", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    const catalogId = c.req.param("catalogId");
    const body = await c.req.json().catch(() => null);
    const parsed = updateCatalogValidator.safeParse(body);
    if (!parsed.success) return c.json({ error: "Validation", message: parsed.error.message }, 400);

    const dto: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) dto["name"] = parsed.data.name;
    if (parsed.data.effectiveDate !== undefined) dto["effectiveDate"] = new Date(parsed.data.effectiveDate);
    if (parsed.data.isActive !== undefined) dto["isActive"] = parsed.data.isActive;
    if (Object.keys(dto).length === 0) return c.json({ error: "Validation", message: "No fields to update" }, 400);

    const updated = await manager.updateCatalog(orgId, catalogId, dto as Parameters<typeof manager.updateCatalog>[2]);
    return c.json(updated);
  });

  router.delete("/:catalogId", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);
    const catalogId = c.req.param("catalogId");
    await manager.deleteCatalog(orgId, catalogId);
    return c.json({ id: catalogId });
  });

  router.post("/:catalogId/activate", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);
    const catalogId = c.req.param("catalogId");
    const catalog = await manager.activateCatalog(orgId, catalogId);
    return c.json(catalog);
  });

  // ── Items ─────────────────────────────────────────────────────────────────

  router.get("/:catalogId/items", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);
    const catalogId = c.req.param("catalogId");
    const rows = await manager.listItems(orgId, catalogId);
    return c.json({ items: rows, total: rows.length });
  });

  router.post("/:catalogId/items", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    const catalogId = c.req.param("catalogId");
    const body = await c.req.json().catch(() => null);
    const parsed = createItemValidator.safeParse(body);
    if (!parsed.success) return c.json({ error: "Validation", message: parsed.error.message }, 400);

    const item = await manager.createItem(orgId, catalogId, {
      ...parsed.data,
      pricePerUnit: String(parsed.data.pricePerUnit),
    });
    return c.json(item, 201);
  });

  router.patch("/:catalogId/items/:itemId", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);

    const catalogId = c.req.param("catalogId");
    const itemId = c.req.param("itemId");
    const body = await c.req.json().catch(() => null);
    const parsed = updateItemValidator.safeParse(body);
    if (!parsed.success) return c.json({ error: "Validation", message: parsed.error.message }, 400);

    const dto: Record<string, unknown> = {};
    if (parsed.data.code !== undefined) dto["code"] = parsed.data.code;
    if (parsed.data.name !== undefined) dto["name"] = parsed.data.name;
    if (parsed.data.description !== undefined) dto["description"] = parsed.data.description;
    if (parsed.data.category !== undefined) dto["category"] = parsed.data.category;
    if (parsed.data.pricePerUnit !== undefined) dto["pricePerUnit"] = String(parsed.data.pricePerUnit);
    if (parsed.data.unit !== undefined) dto["unit"] = parsed.data.unit;
    if (parsed.data.sortOrder !== undefined) dto["sortOrder"] = parsed.data.sortOrder;
    if (parsed.data.isActive !== undefined) dto["isActive"] = parsed.data.isActive;
    if (Object.keys(dto).length === 0) return c.json({ error: "Validation", message: "No fields to update" }, 400);

    const updated = await manager.updateItem(orgId, catalogId, itemId, dto as Parameters<typeof manager.updateItem>[3]);
    return c.json(updated);
  });

  router.delete("/:catalogId/items/:itemId", async (c) => {
    const orgId = c.get("user")?.orgId;
    if (!orgId) return c.json({ error: "Unauthorized", message: "No orgId in token" }, 401);
    const catalogId = c.req.param("catalogId");
    const itemId = c.req.param("itemId");
    await manager.deleteItem(orgId, catalogId, itemId);
    return c.json({ id: itemId });
  });

  return router;
}
