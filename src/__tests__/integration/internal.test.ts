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

import { createTestApp, createAuthHeaders, createWorkerHeaders, type TestContext } from "../helpers/test-app.js";
import { fakeUser, fakeSession } from "../helpers/mock-repos.js";

const UUID_1 = "00000000-0000-0000-0000-000000000001";

describe("Internal API", () => {
  let ctx: TestContext;
  const workerHeaders = {
    "Content-Type": "application/json",
    ...createWorkerHeaders(),
  };

  beforeEach(() => {
    ctx = createTestApp();
  });

  // ── GET /internal/whatsapp/sessions ───────────────────────────────────────────

  it("GET /internal/whatsapp/sessions returns 200 with active sessions", async () => {
    ctx.repos.session.findAllActive.mockResolvedValue([{ userId: "u-1", orgId: "org-1" }]);

    const res = await ctx.app.request("/internal/whatsapp/sessions", {
      headers: workerHeaders,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ userId: "u-1", orgId: "org-1" }]);
  });

  // ── POST /internal/whatsapp/qr ────────────────────────────────────────────────

  it("POST /internal/whatsapp/qr returns 200 on success", async () => {
    ctx.repos.user.findById.mockResolvedValue(fakeUser({ id: UUID_1 }));
    ctx.repos.session.upsertByUserId.mockResolvedValue(undefined);

    const res = await ctx.app.request("/internal/whatsapp/qr", {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({ userId: UUID_1, qrData: "some-qr-data" }),
    });

    expect(res.status).toBe(200);
  });

  // ── POST /internal/whatsapp/status ────────────────────────────────────────────

  it("POST /internal/whatsapp/status returns 200 on success", async () => {
    ctx.repos.user.findById.mockResolvedValue(fakeUser({ id: UUID_1 }));
    ctx.repos.session.upsertByUserId.mockResolvedValue(undefined);

    const res = await ctx.app.request("/internal/whatsapp/status", {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({ userId: UUID_1, status: "connected", phone: "+1234567890" }),
    });

    expect(res.status).toBe(200);
  });

  // ── POST /internal/whatsapp/message ───────────────────────────────────────────

  it("POST /internal/whatsapp/message returns 200 with reply", async () => {
    ctx.repos.user.findById.mockResolvedValue(fakeUser({ id: UUID_1 }));
    ctx.repos.conv.findByTitle.mockResolvedValue({ id: "c-1" });
    ctx.mockAgent.generate.mockResolvedValue({ text: "Hello!", steps: [] });

    const res = await ctx.app.request("/internal/whatsapp/message", {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({
        userId: UUID_1,
        messageId: "m-1",
        body: "Hello",
        chatId: "chat-1",
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.reply).toEqual(expect.any(String));
  });

  // ── Auth guard ────────────────────────────────────────────────────────────────

  it("rejects user JWT with 403", async () => {
    const userHeaders = {
      ...createAuthHeaders({ userId: "u-1", username: "alice", orgId: "org-1", role: "user" }),
    };

    const res = await ctx.app.request("/internal/whatsapp/sessions", {
      headers: userHeaders,
    });

    expect(res.status).toBe(403);
  });

  // ── Validation ────────────────────────────────────────────────────────────────

  it("returns 400 for invalid body on POST /internal/whatsapp/qr", async () => {
    const res = await ctx.app.request("/internal/whatsapp/qr", {
      method: "POST",
      headers: workerHeaders,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });
});
