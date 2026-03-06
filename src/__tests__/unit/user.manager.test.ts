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
    it("first user becomes super_admin regardless of callerRole", async () => {
      const user = fakeUser({ role: "super_admin", metadata: { passwordHash: hashPassword("pass") } });
      repo.count.mockResolvedValue(0);
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(user);

      const result = await manager.register({ username: "alice", password: "pass" });

      expect(repo.count).toHaveBeenCalled();
      expect(repo.findByEmail).toHaveBeenCalledWith("alice");
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "alice",
          role: "super_admin",
        }),
      );
      expect(result.role).toBe("super_admin");
    });

    it("throws ForbiddenError when non-admin tries to register after first user", async () => {
      repo.count.mockResolvedValue(1);

      await expect(
        manager.register({ username: "bob", password: "pass" }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("allows admin to register subsequent users", async () => {
      const user = fakeUser({ email: "bob", role: "user", metadata: { passwordHash: hashPassword("pass") } });
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
          role: "user",
        }),
      );
      expect(result.role).toBe("user");
    });

    it("allows super_admin to register subsequent users", async () => {
      const user = fakeUser({ email: "carol", role: "user", metadata: { passwordHash: hashPassword("pass") } });
      repo.count.mockResolvedValue(1);
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(user);

      const result = await manager.register(
        { username: "carol", password: "pass" },
        "super_admin",
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "carol",
          role: "user",
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
        role: "user",
        metadata: { passwordHash: hashPassword("password") },
      });
      repo.findByEmail.mockResolvedValue(user);

      const result = await manager.login("alice", "password");

      expect(repo.findByEmail).toHaveBeenCalledWith("alice");
      expect(result.user).toEqual(user);
      expect(result.role).toBe("user");
    });

    it("throws UnauthorizedError on wrong password", async () => {
      const user = fakeUser({
        role: "user",
        metadata: { passwordHash: hashPassword("correct") },
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
        role: "user",
        metadata: { passwordHash: hashPassword("pass") },
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
          role: "user",
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

  // ── update ──────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates user email successfully as super_admin", async () => {
      const existing = fakeUser({ id: "u-2", email: "bob", orgId: "org-1" });
      const updated = fakeUser({ id: "u-2", email: "bob-new@test.com", orgId: "org-1" });
      repo.findById.mockResolvedValue(existing);
      repo.findByEmail.mockResolvedValue(null);
      repo.update.mockResolvedValue(updated);

      const result = await manager.update(
        "u-2",
        { email: "bob-new@test.com" },
        "super_admin",
        "org-1",
      );

      expect(repo.update).toHaveBeenCalledWith(
        "u-2",
        expect.objectContaining({ email: "bob-new@test.com" }),
      );
      expect(result.email).toBe("bob-new@test.com");
    });

    it("updates user role successfully as super_admin", async () => {
      const existing = fakeUser({ id: "u-2", email: "bob", orgId: "org-1", role: "user" });
      const updated = fakeUser({ id: "u-2", email: "bob", orgId: "org-1", role: "admin" });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(updated);

      const result = await manager.update(
        "u-2",
        { role: "admin" },
        "super_admin",
        "org-1",
      );

      expect(result.role).toBe("admin");
    });

    it("admin can update user in same org", async () => {
      const existing = fakeUser({ id: "u-2", email: "bob", orgId: "org-1", role: "user" });
      const updated = fakeUser({ id: "u-2", email: "bob-new@test.com", orgId: "org-1" });
      repo.findById.mockResolvedValue(existing);
      repo.findByEmail.mockResolvedValue(null);
      repo.update.mockResolvedValue(updated);

      const result = await manager.update(
        "u-2",
        { email: "bob-new@test.com" },
        "admin",
        "org-1",
      );

      expect(result.email).toBe("bob-new@test.com");
    });

    it("throws Forbidden when admin updates user in different org", async () => {
      const existing = fakeUser({ id: "u-2", email: "bob", orgId: "org-2", role: "user" });
      repo.findById.mockResolvedValue(existing);

      await expect(
        manager.update("u-2", { email: "new@test.com" }, "admin", "org-1"),
      ).rejects.toThrow("Forbidden");
    });

    it("throws Forbidden when regular user tries to update", async () => {
      await expect(
        manager.update("u-2", { email: "new@test.com" }, "user", "org-1"),
      ).rejects.toThrow("Forbidden");
    });

    it("throws when non-super_admin tries to assign super_admin role", async () => {
      const existing = fakeUser({ id: "u-2", email: "bob", orgId: "org-1" });
      repo.findById.mockResolvedValue(existing);

      await expect(
        manager.update("u-2", { role: "super_admin" }, "admin", "org-1"),
      ).rejects.toThrow("Only super_admin can assign super_admin role");
    });

    it("throws when email already in use", async () => {
      const existing = fakeUser({ id: "u-2", email: "bob", orgId: "org-1" });
      repo.findById.mockResolvedValue(existing);
      repo.findByEmail.mockResolvedValue(fakeUser({ id: "u-3", email: "taken@test.com" }));

      await expect(
        manager.update("u-2", { email: "taken@test.com" }, "super_admin", "org-1"),
      ).rejects.toThrow("Email already in use");
    });

    it("throws User not found when user does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        manager.update("u-999", { email: "new@test.com" }, "super_admin", "org-1"),
      ).rejects.toThrow("User not found");
    });

    it("updates password by hashing it into metadata", async () => {
      const existing = fakeUser({ id: "u-2", email: "bob", orgId: "org-1", metadata: { passwordHash: "old" } });
      const updated = fakeUser({ id: "u-2", email: "bob", orgId: "org-1" });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(updated);

      await manager.update("u-2", { password: "newpassword" }, "super_admin", "org-1");

      expect(repo.update).toHaveBeenCalledWith(
        "u-2",
        expect.objectContaining({
          metadata: expect.objectContaining({
            passwordHash: expect.any(String),
          }),
        }),
      );
      // Ensure the hash is not the plaintext password
      const passedMetadata = repo.update.mock.calls[0]![1]["metadata"] as Record<string, unknown>;
      expect(passedMetadata["passwordHash"]).not.toBe("newpassword");
    });
  });

  // ── updateSelf ─────────────────────────────────────────────────────────────

  describe("updateSelf", () => {
    it("updates own email successfully", async () => {
      const existing = fakeUser({ id: "u-1", email: "alice" });
      const updated = fakeUser({ id: "u-1", email: "alice-new@test.com" });
      repo.findById.mockResolvedValue(existing);
      repo.findByEmail.mockResolvedValue(null);
      repo.update.mockResolvedValue(updated);

      const result = await manager.updateSelf("u-1", { email: "alice-new@test.com" });

      expect(repo.update).toHaveBeenCalledWith(
        "u-1",
        expect.objectContaining({ email: "alice-new@test.com" }),
      );
      expect(result.email).toBe("alice-new@test.com");
    });

    it("updates own password successfully", async () => {
      const existing = fakeUser({ id: "u-1", email: "alice", metadata: { passwordHash: "old" } });
      const updated = fakeUser({ id: "u-1", email: "alice" });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(updated);

      await manager.updateSelf("u-1", { password: "newpassword" });

      expect(repo.update).toHaveBeenCalledWith(
        "u-1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            passwordHash: expect.any(String),
          }),
        }),
      );
    });

    it("throws when email already in use", async () => {
      const existing = fakeUser({ id: "u-1", email: "alice" });
      repo.findById.mockResolvedValue(existing);
      repo.findByEmail.mockResolvedValue(fakeUser({ id: "u-3", email: "taken@test.com" }));

      await expect(
        manager.updateSelf("u-1", { email: "taken@test.com" }),
      ).rejects.toThrow("Email already in use");
    });

    it("throws User not found when user does not exist", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        manager.updateSelf("u-999", { email: "new@test.com" }),
      ).rejects.toThrow("User not found");
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
