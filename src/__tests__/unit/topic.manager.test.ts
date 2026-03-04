import { describe, it, expect, beforeEach, vi } from "vitest";
import { TopicManager } from "../../application/managers/topic.manager.js";
import { createMockTopicRepo, fakeTopic, fakeDocument } from "../helpers/mock-repos.js";
import { NotFoundError, ConflictError } from "../../domain/errors/index.js";

describe("TopicManager", () => {
  let repo: ReturnType<typeof createMockTopicRepo>;
  let manager: TopicManager;

  beforeEach(() => {
    repo = createMockTopicRepo();
    manager = new TopicManager(repo);
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe("list(orgId)", () => {
    it("calls repo.findByOrg and returns result", async () => {
      const topics = [fakeTopic(), fakeTopic({ id: "t-2", name: "Sales" })];
      repo.findByOrg.mockResolvedValue(topics);

      const result = await manager.list("org-1");

      expect(repo.findByOrg).toHaveBeenCalledWith("org-1");
      expect(result).toEqual(topics);
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe("create(orgId, name, description?)", () => {
    it("returns the created topic on success", async () => {
      const topic = fakeTopic({ name: "Marketing" });
      repo.create.mockResolvedValue(topic);

      const result = await manager.create("org-1", "Marketing", "Marketing docs");

      expect(repo.create).toHaveBeenCalledWith({
        orgId: "org-1",
        name: "Marketing",
        description: "Marketing docs",
      });
      expect(result).toEqual(topic);
    });

    it("throws ConflictError when repo throws with cause.code 23505", async () => {
      const dbError = new Error("duplicate key");
      (dbError as unknown as Record<string, unknown>).cause = { code: "23505" };
      repo.create.mockRejectedValue(dbError);

      await expect(manager.create("org-1", "Duplicate")).rejects.toThrow(ConflictError);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe("update(id, orgId, data)", () => {
    it("returns the updated topic when found", async () => {
      const updated = fakeTopic({ name: "Renamed" });
      repo.update.mockResolvedValue(updated);

      const result = await manager.update("t-1", "org-1", { name: "Renamed" });

      expect(repo.update).toHaveBeenCalledWith("t-1", "org-1", { name: "Renamed" });
      expect(result).toEqual(updated);
    });

    it("throws NotFoundError when repo.update returns null", async () => {
      repo.update.mockResolvedValue(null);

      await expect(manager.update("t-999", "org-1", { name: "X" })).rejects.toThrow(NotFoundError);
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe("delete(id, orgId)", () => {
    it("resolves when repo.delete returns true", async () => {
      repo.delete.mockResolvedValue(true);

      await expect(manager.delete("t-1", "org-1")).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith("t-1", "org-1");
    });

    it("throws NotFoundError when repo.delete returns false", async () => {
      repo.delete.mockResolvedValue(false);

      await expect(manager.delete("t-999", "org-1")).rejects.toThrow(NotFoundError);
    });
  });

  // ── getDocuments ───────────────────────────────────────────────────────────

  describe("getDocuments(id, orgId)", () => {
    it("returns documents when topic is found", async () => {
      const topic = fakeTopic();
      const docs = [fakeDocument(), fakeDocument({ id: "d-2", title: "Doc 2" })];
      repo.findByOrgAndId.mockResolvedValue(topic);
      repo.findDocumentsByTopic.mockResolvedValue(docs);

      const result = await manager.getDocuments("t-1", "org-1");

      expect(repo.findByOrgAndId).toHaveBeenCalledWith("org-1", "t-1");
      expect(repo.findDocumentsByTopic).toHaveBeenCalledWith("t-1");
      expect(result).toEqual(docs);
    });

    it("throws NotFoundError when topic is not found", async () => {
      repo.findByOrgAndId.mockResolvedValue(null);

      await expect(manager.getDocuments("t-999", "org-1")).rejects.toThrow(NotFoundError);
    });
  });
});
