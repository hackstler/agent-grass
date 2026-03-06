import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

import { createTestApp, createAuthHeaders, type TestContext } from "../helpers/test-app.js";
import { fakeUser, fakeOrganization, fakeSession } from "../helpers/mock-repos.js";

describe("Admin API", () => {
  let ctx: TestContext;
  // super_admin headers — global access
  const superAdminHeaders = {
    "Content-Type": "application/json",
    ...createAuthHeaders({ userId: "u-1", username: "admin", orgId: "org-1", role: "super_admin" }),
  };
  // org-scoped admin headers — restricted to own org
  const orgAdminHeaders = {
    "Content-Type": "application/json",
    ...createAuthHeaders({ userId: "u-2", username: "orgadmin", orgId: "org-1", role: "admin" }),
  };

  beforeEach(() => {
    ctx = createTestApp();
  });

  // ── GET /admin/users ──────────────────────────────────────────────────────────

  it("GET /admin/users returns 200 with items for super_admin", async () => {
    ctx.repos.user.findAll.mockResolvedValue([fakeUser()]);

    const res = await ctx.app.request("/admin/users", { headers: superAdminHeaders });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it("GET /admin/users scopes by orgId for org-scoped admin", async () => {
    ctx.repos.user.findAll.mockResolvedValue([fakeUser()]);

    const res = await ctx.app.request("/admin/users", { headers: orgAdminHeaders });

    expect(res.status).toBe(200);
    expect(ctx.repos.user.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1" }),
    );
  });

  // ── POST /admin/users ─────────────────────────────────────────────────────────

  it("POST /admin/users returns 201 on success for super_admin", async () => {
    ctx.repos.user.findByEmail.mockResolvedValue(null);
    ctx.repos.user.create.mockResolvedValue(
      fakeUser({ id: "u-new", email: "bob", orgId: "org-2" }),
    );

    const res = await ctx.app.request("/admin/users", {
      method: "POST",
      headers: superAdminHeaders,
      body: JSON.stringify({ username: "bob", password: "password123", orgId: "org-2" }),
    });

    expect(res.status).toBe(201);
  });

  it("POST /admin/users returns 403 when org-admin creates user in other org", async () => {
    const res = await ctx.app.request("/admin/users", {
      method: "POST",
      headers: orgAdminHeaders,
      body: JSON.stringify({ username: "bob", password: "password123", orgId: "org-2" }),
    });

    expect(res.status).toBe(403);
  });

  it("POST /admin/users returns 409 on duplicate user", async () => {
    ctx.repos.user.findByEmail.mockResolvedValue(fakeUser());

    const res = await ctx.app.request("/admin/users", {
      method: "POST",
      headers: superAdminHeaders,
      body: JSON.stringify({ username: "alice", password: "password123", orgId: "org-1" }),
    });

    expect(res.status).toBe(409);
  });

  // ── DELETE /admin/users/:id ───────────────────────────────────────────────────

  it("DELETE /admin/users/:id returns 200 when deleting another user", async () => {
    ctx.repos.user.delete.mockResolvedValue(true);

    const res = await ctx.app.request("/admin/users/u-2", {
      method: "DELETE",
      headers: superAdminHeaders,
    });

    expect(res.status).toBe(200);
  });

  it("DELETE /admin/users/:id returns 400 when deleting self", async () => {
    const res = await ctx.app.request("/admin/users/u-1", {
      method: "DELETE",
      headers: superAdminHeaders,
    });

    expect(res.status).toBe(400);
  });

  // ── GET /admin/organizations ──────────────────────────────────────────────────

  it("GET /admin/organizations returns all orgs for super_admin", async () => {
    ctx.repos.user.countByOrg.mockResolvedValue([
      { orgId: "org-1", userCount: 2, earliestCreatedAt: new Date() },
    ]);
    ctx.repos.doc.countByOrg.mockResolvedValue([{ orgId: "org-1", docCount: 5 }]);

    const res = await ctx.app.request("/admin/organizations", { headers: superAdminHeaders });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  it("GET /admin/organizations returns only own org for org-scoped admin", async () => {
    ctx.repos.org.findByOrgId.mockResolvedValue(fakeOrganization({ orgId: "org-1" }));

    const res = await ctx.app.request("/admin/organizations", { headers: orgAdminHeaders });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  // ── POST /admin/organizations ─────────────────────────────────────────────────

  it("POST /admin/organizations returns 201 for super_admin", async () => {
    ctx.repos.user.findFirstByOrg.mockResolvedValue(null);
    ctx.repos.user.findByEmail.mockResolvedValue(null);
    ctx.repos.org.create.mockResolvedValue(fakeOrganization({ orgId: "new-org" }));
    ctx.repos.user.create.mockResolvedValue(
      fakeUser({ id: "u-org", email: "orgadmin", orgId: "new-org" }),
    );

    const res = await ctx.app.request("/admin/organizations", {
      method: "POST",
      headers: superAdminHeaders,
      body: JSON.stringify({
        orgId: "new-org",
        adminUsername: "orgadmin",
        adminPassword: "password123",
      }),
    });

    expect(res.status).toBe(201);
  });

  it("POST /admin/organizations returns 403 for org-scoped admin", async () => {
    const res = await ctx.app.request("/admin/organizations", {
      method: "POST",
      headers: orgAdminHeaders,
      body: JSON.stringify({
        orgId: "new-org",
        adminUsername: "orgadmin",
        adminPassword: "password123",
      }),
    });

    expect(res.status).toBe(403);
  });

  it("POST /admin/organizations returns 409 on duplicate org", async () => {
    ctx.repos.user.findFirstByOrg.mockResolvedValue(fakeUser());

    const res = await ctx.app.request("/admin/organizations", {
      method: "POST",
      headers: superAdminHeaders,
      body: JSON.stringify({
        orgId: "org-1",
        adminUsername: "admin2",
        adminPassword: "password123",
      }),
    });

    expect(res.status).toBe(409);
  });

  // ── DELETE /admin/organizations/:orgId ────────────────────────────────────────

  it("DELETE /admin/organizations/:orgId returns 200 for super_admin", async () => {
    ctx.repos.user.findFirstByOrg.mockResolvedValue(fakeUser());
    ctx.repos.doc.deleteByOrg.mockResolvedValue(undefined);
    ctx.repos.topic.deleteByOrg.mockResolvedValue(undefined);
    ctx.repos.session.deleteByOrgId.mockResolvedValue(undefined);
    ctx.repos.user.deleteByOrg.mockResolvedValue(undefined);
    ctx.repos.org.deleteByOrgId.mockResolvedValue(undefined);

    const res = await ctx.app.request("/admin/organizations/org-2", {
      method: "DELETE",
      headers: superAdminHeaders,
    });

    expect(res.status).toBe(200);
  });

  it("DELETE /admin/organizations/:orgId returns 403 for org-scoped admin", async () => {
    const res = await ctx.app.request("/admin/organizations/org-2", {
      method: "DELETE",
      headers: orgAdminHeaders,
    });

    expect(res.status).toBe(403);
  });

  // ── WhatsApp sessions ─────────────────────────────────────────────────────────

  it("GET /admin/whatsapp/sessions returns sessions for super_admin", async () => {
    ctx.repos.session.findAllWithUser.mockResolvedValue([]);

    const res = await ctx.app.request("/admin/whatsapp/sessions", { headers: superAdminHeaders });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toBeDefined();
  });

  it("GET /admin/whatsapp/sessions scopes by org for org-admin", async () => {
    ctx.repos.session.findAllWithUserByOrg.mockResolvedValue([]);

    const res = await ctx.app.request("/admin/whatsapp/sessions", { headers: orgAdminHeaders });

    expect(res.status).toBe(200);
    expect(ctx.repos.session.findAllWithUserByOrg).toHaveBeenCalledWith("org-1");
  });

  it("POST /admin/whatsapp/sessions/:userId/revoke disconnects session", async () => {
    ctx.repos.session.findByUserId.mockResolvedValue(fakeSession());
    ctx.repos.session.updateByUserId.mockResolvedValue(undefined);

    const res = await ctx.app.request("/admin/whatsapp/sessions/u-1/revoke", {
      method: "POST",
      headers: superAdminHeaders,
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
