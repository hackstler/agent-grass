import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";

// Must mock before importing test-app
vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

import { createTestApp, createAuthHeaders, type TestContext, TEST_JWT_SECRET } from "../helpers/test-app.js";
import { fakeUser } from "../helpers/mock-repos.js";

const PASSWORD_SALT = TEST_JWT_SECRET;

function hashPassword(password: string): string {
  return createHash("sha256").update(`${PASSWORD_SALT}:${password}`).digest("hex");
}

describe("Auth API", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    vi.clearAllMocks();
  });

  // ── POST /auth/register ──────────────────────────────────────────────────

  describe("POST /auth/register", () => {
    it("first user becomes auto-super_admin without auth header", async () => {
      const user = fakeUser({ id: "u-1", email: "alice", orgId: "alice" });
      ctx.repos.user.count.mockResolvedValue(0);
      ctx.repos.user.findByEmail.mockResolvedValue(null);
      ctx.repos.user.create.mockResolvedValue(user);

      const res = await ctx.app.request("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "password123" }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.user.role).toBe("super_admin");
    });

    it("second user registration succeeds with super_admin auth", async () => {
      const user = fakeUser({ id: "u-2", email: "bob", orgId: "bob" });
      ctx.repos.user.count.mockResolvedValue(1);
      ctx.repos.user.findByEmail.mockResolvedValue(null);
      ctx.repos.user.create.mockResolvedValue(user);

      const res = await ctx.app.request("/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...createAuthHeaders({ userId: "u-1", username: "alice", orgId: "org-1", role: "super_admin" }),
        },
        body: JSON.stringify({ username: "bob", password: "password123" }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.token).toBeDefined();
    });

    it("second user registration succeeds with org-scoped admin auth", async () => {
      const user = fakeUser({ id: "u-3", email: "carol", orgId: "carol" });
      ctx.repos.user.count.mockResolvedValue(1);
      ctx.repos.user.findByEmail.mockResolvedValue(null);
      ctx.repos.user.create.mockResolvedValue(user);

      const res = await ctx.app.request("/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...createAuthHeaders({ userId: "u-1", username: "alice", orgId: "org-1", role: "admin" }),
        },
        body: JSON.stringify({ username: "carol", password: "password123" }),
      });

      expect(res.status).toBe(201);
    });

    it("returns 403 when non-admin tries to register after first user", async () => {
      ctx.repos.user.count.mockResolvedValue(1);

      const res = await ctx.app.request("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "bob", password: "password123" }),
      });

      expect(res.status).toBe(403);
    });
  });

  // ── POST /auth/login ─────────────────────────────────────────────────────

  describe("POST /auth/login", () => {
    it("returns token on valid credentials", async () => {
      const passwordHash = hashPassword("password123");
      const user = fakeUser({
        id: "u-1",
        email: "alice",
        orgId: "org-1",
        role: "user",
        metadata: { passwordHash },
      });
      ctx.repos.user.findByEmail.mockResolvedValue(user);

      const res = await ctx.app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "password123" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.user.id).toBe("u-1");
    });

    it("returns 401 on invalid credentials", async () => {
      ctx.repos.user.findByEmail.mockResolvedValue(null);

      const res = await ctx.app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nonexistent", password: "wrong" }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ── GET /auth/me ──────────────────────────────────────────────────────────

  describe("GET /auth/me", () => {
    it("returns user info with valid JWT (super_admin)", async () => {
      const headers = createAuthHeaders({
        userId: "u-1",
        username: "alice",
        orgId: "org-1",
        role: "super_admin",
      });

      const res = await ctx.app.request("/auth/me", {
        method: "GET",
        headers,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        userId: "u-1",
        username: "alice",
        orgId: "org-1",
        role: "super_admin",
      });
    });

    it("returns user info with valid JWT (admin)", async () => {
      const headers = createAuthHeaders({
        userId: "u-1",
        username: "alice",
        orgId: "org-1",
        role: "admin",
      });

      const res = await ctx.app.request("/auth/me", {
        method: "GET",
        headers,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        userId: "u-1",
        username: "alice",
        orgId: "org-1",
        role: "admin",
      });
    });

    it("returns 401 without JWT", async () => {
      const res = await ctx.app.request("/auth/me", {
        method: "GET",
      });

      expect(res.status).toBe(401);
    });
  });
});
