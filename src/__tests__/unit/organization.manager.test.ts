import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrganizationManager } from "../../application/managers/organization.manager.js";
import {
  createMockUserRepo,
  createMockDocumentRepo,
  createMockTopicRepo,
  createMockSessionRepo,
  createMockOrgRepo,
  createMockCatalogRepo,
  fakeUser,
  fakeOrganization,
} from "../helpers/mock-repos.js";
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from "../../domain/errors/index.js";

describe("OrganizationManager", () => {
  let userRepo: ReturnType<typeof createMockUserRepo>;
  let docRepo: ReturnType<typeof createMockDocumentRepo>;
  let topicRepo: ReturnType<typeof createMockTopicRepo>;
  let sessionRepo: ReturnType<typeof createMockSessionRepo>;
  let orgRepo: ReturnType<typeof createMockOrgRepo>;
  let catalogRepo: ReturnType<typeof createMockCatalogRepo>;
  let manager: OrganizationManager;
  const passwordSalt = "test-salt";

  beforeEach(() => {
    userRepo = createMockUserRepo();
    docRepo = createMockDocumentRepo();
    topicRepo = createMockTopicRepo();
    sessionRepo = createMockSessionRepo();
    orgRepo = createMockOrgRepo();
    catalogRepo = createMockCatalogRepo();
    manager = new OrganizationManager(userRepo, docRepo, topicRepo, sessionRepo, orgRepo, catalogRepo, passwordSalt);
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe("list()", () => {
    it("aggregates user and doc counts into OrgSummary[]", async () => {
      userRepo.countByOrg.mockResolvedValue([
        { orgId: "org-1", userCount: 2, earliestCreatedAt: new Date("2025-01-01") },
      ]);
      docRepo.countByOrg.mockResolvedValue([
        { orgId: "org-1", docCount: 5 },
      ]);

      const result = await manager.list();

      expect(userRepo.countByOrg).toHaveBeenCalled();
      expect(docRepo.countByOrg).toHaveBeenCalled();
      expect(result).toEqual([
        {
          orgId: "org-1",
          userCount: 2,
          docCount: 5,
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ]);
    });
  });

  // ── getByOrgId ──────────────────────────────────────────────────────────────

  describe("getByOrgId(orgId)", () => {
    it("returns the organization when found", async () => {
      const org = fakeOrganization({ orgId: "org-1", name: "Acme" });
      orgRepo.findByOrgId.mockResolvedValue(org);

      const result = await manager.getByOrgId("org-1");

      expect(orgRepo.findByOrgId).toHaveBeenCalledWith("org-1");
      expect(result).toEqual(org);
    });

    it("throws NotFoundError when org does not exist", async () => {
      orgRepo.findByOrgId.mockResolvedValue(null);

      await expect(manager.getByOrgId("org-ghost")).rejects.toThrow(NotFoundError);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────

  describe("update(orgId, callerOrgId, data)", () => {
    it("updates the organization when caller owns it", async () => {
      const updated = fakeOrganization({ orgId: "org-1", name: "Acme Updated" });
      orgRepo.update.mockResolvedValue(updated);

      const result = await manager.update("org-1", "org-1", { name: "Acme Updated" });

      expect(orgRepo.update).toHaveBeenCalledWith("org-1", { name: "Acme Updated" });
      expect(result.name).toBe("Acme Updated");
    });

    it("throws ForbiddenError when caller does not own the org", async () => {
      await expect(
        manager.update("org-1", "org-other", { name: "Hacked" }),
      ).rejects.toThrow(ForbiddenError);

      expect(orgRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe("create(dto)", () => {
    const dto = {
      orgId: "org-new",
      adminUsername: "admin@new.com",
      adminPassword: "secret123",
    };

    it("creates the org admin and organization row, returns result on success", async () => {
      userRepo.findFirstByOrg.mockResolvedValue(null);
      userRepo.findByEmail.mockResolvedValue(null);
      orgRepo.create.mockResolvedValue(fakeOrganization({ orgId: "org-new" }));
      const createdUser = fakeUser({
        id: "u-new",
        email: "admin@new.com",
        orgId: "org-new",
        role: "admin",
        metadata: { passwordHash: "hashed" },
        createdAt: new Date("2025-06-01"),
      });
      userRepo.create.mockResolvedValue(createdUser);

      const result = await manager.create(dto);

      expect(userRepo.findFirstByOrg).toHaveBeenCalledWith("org-new");
      expect(userRepo.findByEmail).toHaveBeenCalledWith("admin@new.com");
      expect(orgRepo.create).toHaveBeenCalledWith({
        orgId: "org-new",
        slug: undefined,
        name: undefined,
        address: undefined,
        phone: undefined,
        email: undefined,
        nif: undefined,
        logo: undefined,
        vatRate: undefined,
        currency: undefined,
      });
      expect(userRepo.create).toHaveBeenCalled();
      expect(result.orgId).toBe("org-new");
      expect(result.admin).toMatchObject({
        id: "u-new",
        email: "admin@new.com",
        orgId: "org-new",
        role: "admin",
      });
    });

    it("passes optional org fields to orgRepo.create", async () => {
      userRepo.findFirstByOrg.mockResolvedValue(null);
      userRepo.findByEmail.mockResolvedValue(null);
      orgRepo.create.mockResolvedValue(fakeOrganization({ orgId: "org-new", name: "Acme", slug: "acme" }));
      userRepo.create.mockResolvedValue(fakeUser({ orgId: "org-new" }));

      await manager.create({
        ...dto,
        slug: "acme",
        name: "Acme",
        vatRate: "0.2100",
      });

      expect(orgRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: "acme",
          name: "Acme",
          vatRate: "0.2100",
        }),
      );
    });

    it("throws ConflictError when org already exists", async () => {
      userRepo.findFirstByOrg.mockResolvedValue(fakeUser());

      await expect(manager.create(dto)).rejects.toThrow(ConflictError);
    });

    it("throws ConflictError when admin email already exists", async () => {
      userRepo.findFirstByOrg.mockResolvedValue(null);
      userRepo.findByEmail.mockResolvedValue(fakeUser({ email: "admin@new.com" }));

      await expect(manager.create(dto)).rejects.toThrow(ConflictError);
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe("delete(orgId, callerOrgId)", () => {
    it("cascade-deletes all org resources including organizations row", async () => {
      userRepo.findFirstByOrg.mockResolvedValue(fakeUser({ orgId: "org-target" }));
      catalogRepo.deleteByOrg.mockResolvedValue(undefined);
      docRepo.deleteByOrg.mockResolvedValue(undefined);
      topicRepo.deleteByOrg.mockResolvedValue(undefined);
      sessionRepo.deleteByOrgId.mockResolvedValue(undefined);
      userRepo.deleteByOrg.mockResolvedValue(undefined);
      orgRepo.deleteByOrgId.mockResolvedValue(undefined);

      await expect(manager.delete("org-target", "org-caller")).resolves.toBeUndefined();

      expect(catalogRepo.deleteByOrg).toHaveBeenCalledWith("org-target");
      expect(docRepo.deleteByOrg).toHaveBeenCalledWith("org-target");
      expect(topicRepo.deleteByOrg).toHaveBeenCalledWith("org-target");
      expect(sessionRepo.deleteByOrgId).toHaveBeenCalledWith("org-target");
      expect(userRepo.deleteByOrg).toHaveBeenCalledWith("org-target");
      expect(orgRepo.deleteByOrgId).toHaveBeenCalledWith("org-target");
    });

    it("throws ValidationError when trying to delete own org", async () => {
      await expect(manager.delete("org-1", "org-1")).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError when org does not exist", async () => {
      userRepo.findFirstByOrg.mockResolvedValue(null);

      await expect(manager.delete("org-ghost", "org-caller")).rejects.toThrow(NotFoundError);
    });
  });
});
