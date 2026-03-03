import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConversationManager } from "../../application/managers/conversation.manager.js";
import { createMockConversationRepo, fakeConversation } from "../helpers/mock-repos.js";
import { NotFoundError } from "../../domain/errors/index.js";

describe("ConversationManager", () => {
  let repo: ReturnType<typeof createMockConversationRepo>;
  let manager: ConversationManager;

  beforeEach(() => {
    repo = createMockConversationRepo();
    manager = new ConversationManager(repo);
  });

  // ── list ────────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("calls repo.findAll with provided filters", async () => {
      const conversations = [
        { id: "c-1", title: "Conv 1", createdAt: new Date(), updatedAt: new Date() },
      ];
      const filters = { userId: "u-1", limit: 10 };
      repo.findAll.mockResolvedValue(conversations);

      const result = await manager.list(filters);

      expect(repo.findAll).toHaveBeenCalledWith(filters);
      expect(result).toEqual(conversations);
    });

    it("calls repo.findAll without filters when none provided", async () => {
      repo.findAll.mockResolvedValue([]);

      const result = await manager.list();

      expect(repo.findAll).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([]);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates conversation with provided title", async () => {
      const created = { id: "c-1", title: "My Chat", createdAt: new Date("2025-01-01") };
      repo.create.mockResolvedValue(created);

      const result = await manager.create({ userId: "u-1", title: "My Chat" });

      expect(repo.create).toHaveBeenCalledWith({ userId: "u-1", title: "My Chat" });
      expect(result).toEqual(created);
    });

    it("defaults title to 'New conversation' when not provided", async () => {
      const created = { id: "c-2", title: "New conversation", createdAt: new Date("2025-01-01") };
      repo.create.mockResolvedValue(created);

      const result = await manager.create({ userId: "u-1" });

      expect(repo.create).toHaveBeenCalledWith({ userId: "u-1", title: "New conversation" });
      expect(result).toEqual(created);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────────

  describe("getById", () => {
    it("returns conversation with messages when found", async () => {
      const conv = {
        ...fakeConversation(),
        messages: [
          {
            id: "m-1",
            role: "user" as const,
            content: "Hello",
            metadata: null,
            createdAt: new Date("2025-01-01"),
          },
        ],
      };
      repo.findByIdWithMessages.mockResolvedValue(conv);

      const result = await manager.getById("c-1");

      expect(repo.findByIdWithMessages).toHaveBeenCalledWith("c-1");
      expect(result).toEqual(conv);
      expect(result.messages).toHaveLength(1);
    });

    it("throws NotFoundError when conversation does not exist", async () => {
      repo.findByIdWithMessages.mockResolvedValue(null);

      await expect(manager.getById("c-999")).rejects.toThrow(NotFoundError);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes conversation successfully", async () => {
      repo.delete.mockResolvedValue(true);

      await expect(manager.delete("c-1")).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith("c-1");
    });

    it("throws NotFoundError when conversation does not exist", async () => {
      repo.delete.mockResolvedValue(false);

      await expect(manager.delete("c-999")).rejects.toThrow(NotFoundError);
    });
  });

  // ── resolveOrCreateByTitle ──────────────────────────────────────────────────

  describe("resolveOrCreateByTitle", () => {
    it("returns existing conversation id when found by title", async () => {
      repo.findByTitle.mockResolvedValue({ id: "existing-id" });

      const result = await manager.resolveOrCreateByTitle("whatsapp:123", "u-1");

      expect(repo.findByTitle).toHaveBeenCalledWith("whatsapp:123");
      expect(repo.create).not.toHaveBeenCalled();
      expect(result).toBe("existing-id");
    });

    it("creates new conversation and returns its id when not found", async () => {
      repo.findByTitle.mockResolvedValue(null);
      repo.create.mockResolvedValue({
        id: "new-id",
        title: "whatsapp:456",
        createdAt: new Date("2025-01-01"),
      });

      const result = await manager.resolveOrCreateByTitle("whatsapp:456", "u-1");

      expect(repo.findByTitle).toHaveBeenCalledWith("whatsapp:456");
      expect(repo.create).toHaveBeenCalledWith({ title: "whatsapp:456", userId: "u-1" });
      expect(result).toBe("new-id");
    });
  });
});
