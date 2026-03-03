import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";
import { UserManager } from "../../application/managers/user.manager.js";
import { createMockUserRepo, fakeUser } from "../helpers/mock-repos.js";
import {
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from "../../domain/errors/index.js";

const SALT = "test-salt";

function hashPassword(password: string): string {
  return createHash("sha256").update(`${SALT}:${password}`).digest("hex");
}

describe("UserManager", () => {
  let repo: ReturnType<typeof createMockUserRepo>;
  let manager: UserManager;

  beforeEach(() => {
    repo = createMockUserRepo();
    manager = new UserManager(repo, SALT);
  });

  // ── register ────────────────────────────────────────────────────────────────

  describe("register", () => {
    it("first user becomes admin regardless of callerRole", async () => {
      const user = fakeUser({ metadata: { passwordHash: hashPassword("pass"), role: "admin" } });
      repo.count.mockResolvedValue(0);
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(user);

      const result = await manager.register({ username: "alice", password: "pass" });

      expect(repo.count).toHaveBeenCalled();
      expect(repo.findByEmail).toHaveBeenCalledWith("alice");
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "alice",
          metadata: expect.objectContaining({ role: "admin" }),
        }),
      );
      expect(result.role).toBe("admin");
    });

    it("throws ForbiddenError when non-admin tries to register after first user", async () => {
      repo.count.mockResolvedValue(1);

      await expect(
        manager.register({ username: "bob", password: "pass" }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("allows admin to register subsequent users", async () => {
      const user = fakeUser({ email: "bob", metadata: { passwordHash: hashPassword("pass"), role: "user" } });
      repo.count.mockResolvedValue(1);
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(user);

      const result = await manager.register(
        { username: "bob", password: "pass" },
        "admin",
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "bob",
          metadata: expect.objectContaining({ role: "user" }),
        }),
      );
      expect(result.role).toBe("user");
    });

    it("throws ConflictError when user already exists", async () => {
      repo.count.mockResolvedValue(0);
      repo.findByEmail.mockResolvedValue(fakeUser());

      await expect(
        manager.register({ username: "alice", password: "pass" }),
      ).rejects.toThrow(ConflictError);
    });
  });

  // ── login ───────────────────────────────────────────────────────────────────

  describe("login", () => {
    it("returns user and role on valid credentials", async () => {
      const user = fakeUser({
        metadata: { passwordHash: hashPassword("password"), role: "user" },
      });
      repo.findByEmail.mockResolvedValue(user);

      const result = await manager.login("alice", "password");

      expect(repo.findByEmail).toHaveBeenCalledWith("alice");
      expect(result.user).toEqual(user);
      expect(result.role).toBe("user");
    });

    it("throws UnauthorizedError on wrong password", async () => {
      const user = fakeUser({
        metadata: { passwordHash: hashPassword("correct"), role: "user" },
      });
      repo.findByEmail.mockResolvedValue(user);

      await expect(manager.login("alice", "wrong")).rejects.toThrow(UnauthorizedError);
    });

    it("throws UnauthorizedError when user does not exist", async () => {
      repo.findByEmail.mockResolvedValue(null);

      await expect(manager.login("ghost", "pass")).rejects.toThrow(UnauthorizedError);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────────

  describe("getById", () => {
    it("returns user when found", async () => {
      const user = fakeUser();
      repo.findById.mockResolvedValue(user);

      const result = await manager.getById("u-1");

      expect(repo.findById).toHaveBeenCalledWith("u-1");
      expect(result).toEqual(user);
    });

    it("throws NotFoundError when user does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(manager.getById("u-999")).rejects.toThrow(NotFoundError);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates user and returns UserListItem", async () => {
      const user = fakeUser({
        id: "u-2",
        email: "bob",
        orgId: "org-2",
        metadata: { passwordHash: hashPassword("pass"), role: "user" },
        createdAt: new Date("2025-06-01"),
      });
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(user);

      const result = await manager.create({
        username: "bob",
        password: "pass",
        orgId: "org-2",
      });

      expect(repo.findByEmail).toHaveBeenCalledWith("bob");
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "bob",
          orgId: "org-2",
          metadata: expect.objectContaining({ role: "user" }),
        }),
      );
      expect(result).toEqual({
        id: "u-2",
        email: "bob",
        orgId: "org-2",
        role: "user",
        createdAt: new Date("2025-06-01").toISOString(),
      });
    });

    it("throws ConflictError when email already exists", async () => {
      repo.findByEmail.mockResolvedValue(fakeUser());

      await expect(
        manager.create({ username: "alice", password: "pass", orgId: "org-1" }),
      ).rejects.toThrow(ConflictError);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes user successfully", async () => {
      repo.delete.mockResolvedValue(true);

      await expect(manager.delete("u-2", "u-1")).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith("u-2");
    });

    it("throws ValidationError when deleting own account", async () => {
      await expect(manager.delete("u-1", "u-1")).rejects.toThrow(ValidationError);
      await expect(manager.delete("u-1", "u-1")).rejects.toThrow(
        "Cannot delete your own account",
      );
    });

    it("throws NotFoundError when user does not exist", async () => {
      repo.delete.mockResolvedValue(false);

      await expect(manager.delete("u-999", "u-1")).rejects.toThrow(NotFoundError);
    });
  });

  // ── resolveOrgId ────────────────────────────────────────────────────────────

  describe("resolveOrgId", () => {
    it("returns orgId when user is found", async () => {
      repo.findById.mockResolvedValue(fakeUser({ orgId: "org-1" }));

      const orgId = await manager.resolveOrgId("u-1");

      expect(repo.findById).toHaveBeenCalledWith("u-1");
      expect(orgId).toBe("org-1");
    });

    it("throws NotFoundError when user does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(manager.resolveOrgId("u-999")).rejects.toThrow(NotFoundError);
    });
  });
});
