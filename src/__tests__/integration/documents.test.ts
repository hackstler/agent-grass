import { describe, it, expect, beforeEach, vi } from "vitest";

// Must mock before importing test-app
vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

import { createTestApp, createAuthHeaders, type TestContext } from "../helpers/test-app.js";
import { fakeDocument } from "../helpers/mock-repos.js";

const AUTH = createAuthHeaders({ userId: "u-1", username: "alice", orgId: "org-1", role: "user" });

describe("Documents API", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    vi.clearAllMocks();
  });

  // ── GET /documents ───────────────────────────────────────────────────────

  describe("GET /documents", () => {
    it("returns list of documents with total count", async () => {
      ctx.repos.doc.findByOrg.mockResolvedValue([fakeDocument()]);

      const res = await ctx.app.request("/documents", {
        method: "GET",
        headers: AUTH,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(1);
      expect(data.total).toBe(1);
    });
  });

  // ── DELETE /documents/:id ────────────────────────────────────────────────

  describe("DELETE /documents/:id", () => {
    it("deletes document and returns 200", async () => {
      ctx.repos.doc.delete.mockResolvedValue(true);

      const res = await ctx.app.request("/documents/d-1", {
        method: "DELETE",
        headers: AUTH,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("d-1");
    });

    it("returns 404 when document not found", async () => {
      ctx.repos.doc.delete.mockResolvedValue(false);

      const res = await ctx.app.request("/documents/d-999", {
        method: "DELETE",
        headers: AUTH,
      });

      expect(res.status).toBe(404);
    });
  });
});
