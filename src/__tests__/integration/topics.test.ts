import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

import { createTestApp, createAuthHeaders, type TestContext } from "../helpers/test-app.js";
import { fakeTopic, fakeDocument } from "../helpers/mock-repos.js";
import { ConflictError } from "../../domain/errors/index.js";

describe("Topics API", () => {
  let ctx: TestContext;
  const headers = {
    "Content-Type": "application/json",
    ...createAuthHeaders({ userId: "u-1", username: "alice", orgId: "org-1", role: "user" }),
  };

  beforeEach(() => {
    ctx = createTestApp();
  });

  // ── GET /topics ───────────────────────────────────────────────────────────────

  it("GET /topics returns 200 with items and total", async () => {
    ctx.repos.topic.findByOrg.mockResolvedValue([fakeTopic()]);

    const res = await ctx.app.request("/topics", { headers });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  // ── POST /topics ──────────────────────────────────────────────────────────────

  it("POST /topics returns 201 on success", async () => {
    ctx.repos.topic.create.mockResolvedValue(fakeTopic());

    const res = await ctx.app.request("/topics", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "General", description: "General topic" }),
    });

    expect(res.status).toBe(201);
  });

  it("POST /topics returns 409 on duplicate name", async () => {
    ctx.repos.topic.create.mockRejectedValue(new ConflictError("Topic", "name 'Existing'"));

    const res = await ctx.app.request("/topics", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Existing" }),
    });

    expect(res.status).toBe(409);
  });

  // ── PATCH /topics/:id ─────────────────────────────────────────────────────────

  it("PATCH /topics/:id returns 200 on success", async () => {
    ctx.repos.topic.update.mockResolvedValue(fakeTopic({ name: "Updated" }));

    const res = await ctx.app.request("/topics/t-1", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Updated" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Updated");
  });

  // ── DELETE /topics/:id ────────────────────────────────────────────────────────

  it("DELETE /topics/:id returns 200 when topic exists", async () => {
    ctx.repos.topic.delete.mockResolvedValue(true);

    const res = await ctx.app.request("/topics/t-1", {
      method: "DELETE",
      headers,
    });

    expect(res.status).toBe(200);
  });

  it("DELETE /topics/:id returns 404 when topic does not exist", async () => {
    ctx.repos.topic.delete.mockResolvedValue(false);

    const res = await ctx.app.request("/topics/t-999", {
      method: "DELETE",
      headers,
    });

    expect(res.status).toBe(404);
  });

  // ── GET /topics/:id/documents ─────────────────────────────────────────────────

  it("GET /topics/:id/documents returns 200 with items", async () => {
    ctx.repos.topic.findByOrgAndId.mockResolvedValue(fakeTopic());
    ctx.repos.topic.findDocumentsByTopic.mockResolvedValue([fakeDocument()]);

    const res = await ctx.app.request("/topics/t-1/documents", { headers });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
  });
});
