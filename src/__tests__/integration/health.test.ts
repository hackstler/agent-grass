import { describe, it, expect, beforeEach, vi } from "vitest";

// Must mock before importing test-app
vi.mock("../../infrastructure/db/client.js", () => ({
  db: {},
  checkDbConnection: vi.fn().mockResolvedValue(true),
  ensurePgVector: vi.fn(),
  runMigrations: vi.fn(),
}));

import { createTestApp, type TestContext } from "../helpers/test-app.js";

describe("GET /health", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("returns 200 with status ok and service details", async () => {
    const res = await ctx.app.request("/health");

    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual({
      status: "ok",
      services: { database: "ok" },
      version: "0.1.0",
      timestamp: expect.any(String),
    });
  });
});
