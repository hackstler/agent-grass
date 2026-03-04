import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

import { createTestApp, createAuthHeaders, type TestContext } from "../helpers/test-app.js";
import { fakeUser } from "../helpers/mock-repos.js";

describe("Admin API", () => {
  let ctx: TestContext;
  const adminHeaders = {
    "Content-Type": "application/json",
    ...createAuthHeaders({ userId: "u-1", username: "admin", orgId: "org-1", role: "admin" }),
  };

  beforeEach(() => {
    ctx = createTestApp();
  });

  // ── GET /admin/users ──────────────────────────────────────────────────────────

  it("GET /admin/users returns 200 with items and total", async () => {
    ctx.repos.user.findAll.mockResolvedValue([fakeUser()]);

    const res = await ctx.app.request("/admin/users", { headers: adminHeaders });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  // ── POST /admin/users ─────────────────────────────────────────────────────────

  it("POST /admin/users returns 201 on success", async () => {
    ctx.repos.user.findByEmail.mockResolvedValue(null);
    ctx.repos.user.create.mockResolvedValue(
      fakeUser({ id: "u-new", email: "bob", orgId: "org-2" }),
    );

    const res = await ctx.app.request("/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ username: "bob", password: "password123", orgId: "org-2" }),
    });

    expect(res.status).toBe(201);
  });

  it("POST /admin/users returns 409 on duplicate user", async () => {
    ctx.repos.user.findByEmail.mockResolvedValue(fakeUser());

    const res = await ctx.app.request("/admin/users", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ username: "alice", password: "password123", orgId: "org-1" }),
    });

    expect(res.status).toBe(409);
  });

  // ── DELETE /admin/users/:id ───────────────────────────────────────────────────

  it("DELETE /admin/users/:id returns 200 when deleting another user", async () => {
    ctx.repos.user.delete.mockResolvedValue(true);

    const res = await ctx.app.request("/admin/users/u-2", {
      method: "DELETE",
      headers: adminHeaders,
    });

    expect(res.status).toBe(200);
  });

  it("DELETE /admin/users/:id returns 400 when deleting self", async () => {
    // Admin headers have userId "u-1", so deleting u-1 should be rejected
    const res = await ctx.app.request("/admin/users/u-1", {
      method: "DELETE",
      headers: adminHeaders,
    });

    expect(res.status).toBe(400);
  });

  // ── GET /admin/organizations ──────────────────────────────────────────────────

  it("GET /admin/organizations returns 200 with items", async () => {
    ctx.repos.user.countByOrg.mockResolvedValue([
      { orgId: "org-1", userCount: 2, earliestCreatedAt: new Date() },
    ]);
    ctx.repos.doc.countByOrg.mockResolvedValue([{ orgId: "org-1", docCount: 5 }]);

    const res = await ctx.app.request("/admin/organizations", { headers: adminHeaders });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  // ── POST /admin/organizations ─────────────────────────────────────────────────

  it("POST /admin/organizations returns 201 on success", async () => {
    ctx.repos.user.findFirstByOrg.mockResolvedValue(null);
    ctx.repos.user.findByEmail.mockResolvedValue(null);
    ctx.repos.user.create.mockResolvedValue(
      fakeUser({ id: "u-org", email: "orgadmin", orgId: "new-org" }),
    );

    const res = await ctx.app.request("/admin/organizations", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        orgId: "new-org",
        adminUsername: "orgadmin",
        adminPassword: "password123",
      }),
    });

    expect(res.status).toBe(201);
  });

  it("POST /admin/organizations returns 409 on duplicate org", async () => {
    ctx.repos.user.findFirstByOrg.mockResolvedValue(fakeUser());

    const res = await ctx.app.request("/admin/organizations", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        orgId: "org-1",
        adminUsername: "admin2",
        adminPassword: "password123",
      }),
    });

    expect(res.status).toBe(409);
  });

  // ── DELETE /admin/organizations/:orgId ────────────────────────────────────────

  it("DELETE /admin/organizations/:orgId returns 200 when deleting another org", async () => {
    ctx.repos.user.findFirstByOrg.mockResolvedValue(fakeUser());
    ctx.repos.doc.deleteByOrg.mockResolvedValue(undefined);
    ctx.repos.topic.deleteByOrg.mockResolvedValue(undefined);
    ctx.repos.session.deleteByOrgId.mockResolvedValue(undefined);
    ctx.repos.user.deleteByOrg.mockResolvedValue(undefined);

    const res = await ctx.app.request("/admin/organizations/org-2", {
      method: "DELETE",
      headers: adminHeaders,
    });

    expect(res.status).toBe(200);
  });

  // ── Role guard ────────────────────────────────────────────────────────────────

  it("returns 403 for regular user accessing admin endpoints", async () => {
    const userHeaders = {
      ...createAuthHeaders({ userId: "u-1", username: "alice", orgId: "org-1", role: "user" }),
    };

    const res = await ctx.app.request("/admin/users", { headers: userHeaders });

    expect(res.status).toBe(403);
  });
});
