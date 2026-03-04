import { describe, it, expect, beforeEach, vi } from "vitest";

// Must mock before importing test-app
vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

import { createTestApp, createAuthHeaders, type TestContext } from "../helpers/test-app.js";
import { fakeConversation } from "../helpers/mock-repos.js";

const AUTH = createAuthHeaders({ userId: "u-1", username: "alice", orgId: "org-1", role: "user" });

describe("Conversations API", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    vi.clearAllMocks();
  });

  // ── POST /conversations ──────────────────────────────────────────────────

  describe("POST /conversations", () => {
    it("creates a conversation and returns 201", async () => {
      ctx.repos.conv.create.mockResolvedValue({
        id: "c-1",
        title: "New conversation",
        createdAt: new Date("2025-01-01"),
      });

      const res = await ctx.app.request("/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe("c-1");
      expect(data.title).toBe("New conversation");
    });
  });

  // ── GET /conversations ───────────────────────────────────────────────────

  describe("GET /conversations", () => {
    it("returns list of conversations", async () => {
      ctx.repos.conv.findAll.mockResolvedValue([
        fakeConversation({ id: "c-1" }),
        fakeConversation({ id: "c-2", title: "Second conv" }),
      ]);

      const res = await ctx.app.request("/conversations", {
        method: "GET",
        headers: AUTH,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
    });
  });

  // ── GET /conversations/:id ──────────────────────────────────────────────

  describe("GET /conversations/:id", () => {
    it("returns conversation with messages", async () => {
      ctx.repos.conv.findByIdWithMessages.mockResolvedValue({
        ...fakeConversation({ id: "c-1" }),
        messages: [],
      });

      const res = await ctx.app.request("/conversations/c-1", {
        method: "GET",
        headers: AUTH,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("c-1");
      expect(Array.isArray(data.messages)).toBe(true);
    });

    it("returns 404 when conversation not found", async () => {
      ctx.repos.conv.findByIdWithMessages.mockResolvedValue(null);

      const res = await ctx.app.request("/conversations/c-999", {
        method: "GET",
        headers: AUTH,
      });

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /conversations/:id ───────────────────────────────────────────

  describe("DELETE /conversations/:id", () => {
    it("deletes conversation and returns 200", async () => {
      ctx.repos.conv.delete.mockResolvedValue(true);

      const res = await ctx.app.request("/conversations/c-1", {
        method: "DELETE",
        headers: AUTH,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleted).toBe(true);
      expect(data.id).toBe("c-1");
    });

    it("returns 404 when conversation not found", async () => {
      ctx.repos.conv.delete.mockResolvedValue(false);

      const res = await ctx.app.request("/conversations/c-999", {
        method: "DELETE",
        headers: AUTH,
      });

      expect(res.status).toBe(404);
    });
  });
});
