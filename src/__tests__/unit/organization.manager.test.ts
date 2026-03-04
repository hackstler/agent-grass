import { describe, it, expect, beforeEach, vi } from "vitest";
import { OrganizationManager } from "../../application/managers/organization.manager.js";
import {
  createMockUserRepo,
  createMockDocumentRepo,
  createMockTopicRepo,
  createMockSessionRepo,
  fakeUser,
} from "../helpers/mock-repos.js";
import { NotFoundError, ConflictError, ValidationError } from "../../domain/errors/index.js";

describe("OrganizationManager", () => {
  let userRepo: ReturnType<typeof createMockUserRepo>;
  let docRepo: ReturnType<typeof createMockDocumentRepo>;
  let topicRepo: ReturnType<typeof createMockTopicRepo>;
  let sessionRepo: ReturnType<typeof createMockSessionRepo>;
  let manager: OrganizationManager;
  const passwordSalt = "test-salt";

  beforeEach(() => {
    userRepo = createMockUserRepo();
    docRepo = createMockDocumentRepo();
    topicRepo = createMockTopicRepo();
    sessionRepo = createMockSessionRepo();
    manager = new OrganizationManager(userRepo, docRepo, topicRepo, sessionRepo, passwordSalt);
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

  // ── create ─────────────────────────────────────────────────────────────────

  describe("create(dto)", () => {
    const dto = {
      orgId: "org-new",
      adminUsername: "admin@new.com",
      adminPassword: "secret123",
    };

    it("creates the org admin and returns result on success", async () => {
      userRepo.findFirstByOrg.mockResolvedValue(null);
      userRepo.findByEmail.mockResolvedValue(null);
      const createdUser = fakeUser({
        id: "u-new",
        email: "admin@new.com",
        orgId: "org-new",
        metadata: { passwordHash: "hashed", role: "admin" },
        createdAt: new Date("2025-06-01"),
      });
      userRepo.create.mockResolvedValue(createdUser);

      const result = await manager.create(dto);

      expect(userRepo.findFirstByOrg).toHaveBeenCalledWith("org-new");
      expect(userRepo.findByEmail).toHaveBeenCalledWith("admin@new.com");
      expect(userRepo.create).toHaveBeenCalled();
      expect(result.orgId).toBe("org-new");
      expect(result.admin).toMatchObject({
        id: "u-new",
        email: "admin@new.com",
        orgId: "org-new",
        role: "admin",
      });
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
    it("cascade-deletes all org resources when org exists", async () => {
      userRepo.findFirstByOrg.mockResolvedValue(fakeUser({ orgId: "org-target" }));
      docRepo.deleteByOrg.mockResolvedValue(undefined);
      topicRepo.deleteByOrg.mockResolvedValue(undefined);
      sessionRepo.deleteByOrgId.mockResolvedValue(undefined);
      userRepo.deleteByOrg.mockResolvedValue(undefined);

      await expect(manager.delete("org-target", "org-caller")).resolves.toBeUndefined();

      expect(docRepo.deleteByOrg).toHaveBeenCalledWith("org-target");
      expect(topicRepo.deleteByOrg).toHaveBeenCalledWith("org-target");
      expect(sessionRepo.deleteByOrgId).toHaveBeenCalledWith("org-target");
      expect(userRepo.deleteByOrg).toHaveBeenCalledWith("org-target");
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
