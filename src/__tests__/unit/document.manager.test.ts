import { describe, it, expect, beforeEach, vi } from "vitest";
import { DocumentManager } from "../../application/managers/document.manager.js";
import { createMockDocumentRepo, fakeDocument } from "../helpers/mock-repos.js";
import { NotFoundError } from "../../domain/errors/index.js";

describe("DocumentManager", () => {
  let repo: ReturnType<typeof createMockDocumentRepo>;
  let manager: DocumentManager;

  beforeEach(() => {
    repo = createMockDocumentRepo();
    manager = new DocumentManager(repo);
  });

  // ── list ────────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns documents for a given orgId", async () => {
      const docs = [fakeDocument(), fakeDocument({ id: "d-2", title: "Doc 2" })];
      repo.findByOrg.mockResolvedValue(docs);

      const result = await manager.list("org-1");

      expect(repo.findByOrg).toHaveBeenCalledWith("org-1", undefined);
      expect(result).toEqual(docs);
    });

    it("passes filters to repo.findByOrg", async () => {
      const docs = [fakeDocument()];
      const filters = { contentType: "pdf", search: "test" };
      repo.findByOrg.mockResolvedValue(docs);

      const result = await manager.list("org-1", filters);

      expect(repo.findByOrg).toHaveBeenCalledWith("org-1", filters);
      expect(result).toEqual(docs);
    });

  });

  // ── delete ──────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("deletes document successfully", async () => {
      repo.delete.mockResolvedValue(true);

      await expect(manager.delete("d-1", "org-1")).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith("d-1", "org-1");
    });

    it("throws NotFoundError when document does not exist", async () => {
      repo.delete.mockResolvedValue(false);

      await expect(manager.delete("d-999", "org-1")).rejects.toThrow(NotFoundError);
    });
  });
});
