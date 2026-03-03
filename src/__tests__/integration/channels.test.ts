import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

vi.mock("../../api/helpers/persist-messages.js", () => ({
  persistMessages: vi.fn().mockResolvedValue(undefined),
}));

import { createTestApp, createAuthHeaders, type TestContext } from "../helpers/test-app.js";
import { fakeSession } from "../helpers/mock-repos.js";

describe("Channels API", () => {
  let ctx: TestContext;
  const headers = {
    "Content-Type": "application/json",
    ...createAuthHeaders({ userId: "u-1", username: "alice", orgId: "org-1", role: "user" }),
  };

  beforeEach(() => {
    ctx = createTestApp();
  });

  // ── GET /channels/whatsapp/status ─────────────────────────────────────────────

  it("GET /channels/whatsapp/status returns 200 with session data", async () => {
    ctx.repos.session.findByUserId.mockResolvedValue(fakeSession());

    const res = await ctx.app.request("/channels/whatsapp/status", { headers });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      status: "connected",
      phone: "+1234567890",
      updatedAt: expect.any(String),
    });
  });

  // ── GET /channels/whatsapp/qr ─────────────────────────────────────────────────

  it("GET /channels/whatsapp/qr returns 200 with qrData", async () => {
    ctx.repos.session.findByUserId.mockResolvedValue(
      fakeSession({ status: "qr", qrData: "QR_DATA_HERE" }),
    );

    const res = await ctx.app.request("/channels/whatsapp/qr", { headers });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ qrData: "QR_DATA_HERE" });
  });

  it("GET /channels/whatsapp/qr returns 404 when no session exists", async () => {
    ctx.repos.session.findByUserId.mockResolvedValue(null);

    const res = await ctx.app.request("/channels/whatsapp/qr", { headers });

    expect(res.status).toBe(404);
  });

  // ── POST /channels/whatsapp/enable ────────────────────────────────────────────

  it("POST /channels/whatsapp/enable returns 201 on success", async () => {
    ctx.repos.session.findByUserId.mockResolvedValue(null);
    ctx.repos.session.create.mockResolvedValue({
      id: "s-1",
      userId: "u-1",
      orgId: "org-1",
      status: "pending",
    });

    const res = await ctx.app.request("/channels/whatsapp/enable", {
      method: "POST",
      headers,
    });

    expect(res.status).toBe(201);
  });

  it("POST /channels/whatsapp/enable returns 409 when session already exists", async () => {
    ctx.repos.session.findByUserId.mockResolvedValue(fakeSession());

    const res = await ctx.app.request("/channels/whatsapp/enable", {
      method: "POST",
      headers,
    });

    expect(res.status).toBe(409);
  });

  // ── POST /channels/whatsapp/disconnect ────────────────────────────────────────

  it("POST /channels/whatsapp/disconnect returns 200 on success", async () => {
    ctx.repos.session.findByUserId.mockResolvedValue(fakeSession());
    ctx.repos.session.updateByUserId.mockResolvedValue(undefined);

    const res = await ctx.app.request("/channels/whatsapp/disconnect", {
      method: "POST",
      headers,
    });

    expect(res.status).toBe(200);
  });
});
