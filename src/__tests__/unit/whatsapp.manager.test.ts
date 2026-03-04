import { describe, it, expect, beforeEach, vi } from "vitest";
import { WhatsAppManager } from "../../application/managers/whatsapp.manager.js";
import { createMockSessionRepo, createMockUserRepo, fakeSession, fakeUser } from "../helpers/mock-repos.js";
import { NotFoundError, ConflictError } from "../../domain/errors/index.js";

describe("WhatsAppManager", () => {
  let sessionRepo: ReturnType<typeof createMockSessionRepo>;
  let userRepo: ReturnType<typeof createMockUserRepo>;
  let manager: WhatsAppManager;

  beforeEach(() => {
    sessionRepo = createMockSessionRepo();
    userRepo = createMockUserRepo();
    manager = new WhatsAppManager(sessionRepo, userRepo);
  });

  // ── getStatusForUser ───────────────────────────────────────────────────────

  describe("getStatusForUser(userId)", () => {
    it("returns status, phone, and updatedAt when session exists", async () => {
      const session = fakeSession({ status: "connected", phone: "+1234567890" });
      sessionRepo.findByUserId.mockResolvedValue(session);

      const result = await manager.getStatusForUser("u-1");

      expect(sessionRepo.findByUserId).toHaveBeenCalledWith("u-1");
      expect(result).toEqual({
        status: "connected",
        phone: "+1234567890",
        updatedAt: session.updatedAt.toISOString(),
      });
    });

    it("returns not_enabled when no session exists", async () => {
      sessionRepo.findByUserId.mockResolvedValue(null);

      const result = await manager.getStatusForUser("u-1");

      expect(result).toEqual({ status: "not_enabled", phone: null });
    });
  });

  // ── getQrForUser ───────────────────────────────────────────────────────────

  describe("getQrForUser(userId)", () => {
    it("returns qrData when session has status qr", async () => {
      const session = fakeSession({ status: "qr", qrData: "base64-qr-data" });
      sessionRepo.findByUserId.mockResolvedValue(session);

      const result = await manager.getQrForUser("u-1");

      expect(result).toEqual({ qrData: "base64-qr-data" });
    });

    it("throws NotFoundError when no session exists", async () => {
      sessionRepo.findByUserId.mockResolvedValue(null);

      await expect(manager.getQrForUser("u-1")).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError when session status is not qr", async () => {
      const session = fakeSession({ status: "connected", qrData: null });
      sessionRepo.findByUserId.mockResolvedValue(session);

      await expect(manager.getQrForUser("u-1")).rejects.toThrow(NotFoundError);
    });
  });

  // ── enableForUser ──────────────────────────────────────────────────────────

  describe("enableForUser(userId, orgId)", () => {
    it("creates a pending session when none exists", async () => {
      sessionRepo.findByUserId.mockResolvedValue(null);
      const created = { id: "s-new", userId: "u-1", orgId: "org-1", status: "pending" };
      sessionRepo.create.mockResolvedValue(created);

      const result = await manager.enableForUser("u-1", "org-1");

      expect(sessionRepo.create).toHaveBeenCalledWith({
        userId: "u-1",
        orgId: "org-1",
        status: "pending",
      });
      expect(result).toEqual(created);
    });

    it("throws ConflictError when session already exists", async () => {
      sessionRepo.findByUserId.mockResolvedValue(fakeSession());

      await expect(manager.enableForUser("u-1", "org-1")).rejects.toThrow(ConflictError);
    });
  });

  // ── disconnectForUser ──────────────────────────────────────────────────────

  describe("disconnectForUser(userId)", () => {
    it("updates session to disconnected when found", async () => {
      sessionRepo.findByUserId.mockResolvedValue(fakeSession());
      sessionRepo.updateByUserId.mockResolvedValue(undefined);

      await expect(manager.disconnectForUser("u-1")).resolves.toBeUndefined();

      expect(sessionRepo.updateByUserId).toHaveBeenCalledWith("u-1", {
        status: "disconnected",
        qrData: null,
        phone: null,
      });
    });

    it("throws NotFoundError when no session exists", async () => {
      sessionRepo.findByUserId.mockResolvedValue(null);

      await expect(manager.disconnectForUser("u-1")).rejects.toThrow(NotFoundError);
    });
  });

  // ── listActiveSessions ─────────────────────────────────────────────────────

  describe("listActiveSessions()", () => {
    it("calls sessionRepo.findAllActive and returns result", async () => {
      const sessions = [
        { userId: "u-1", orgId: "org-1" },
        { userId: "u-2", orgId: "org-2" },
      ];
      sessionRepo.findAllActive.mockResolvedValue(sessions);

      const result = await manager.listActiveSessions();

      expect(sessionRepo.findAllActive).toHaveBeenCalled();
      expect(result).toEqual(sessions);
    });
  });

  // ── reportQr ───────────────────────────────────────────────────────────────

  describe("reportQr(userId, qrData)", () => {
    it("upserts session with qr status and returns result", async () => {
      const user = fakeUser({ id: "u-1", orgId: "org-1" });
      userRepo.findById.mockResolvedValue(user);
      sessionRepo.upsertByUserId.mockResolvedValue(fakeSession({ status: "qr" }));

      const result = await manager.reportQr("u-1", "qr-data-123");

      expect(userRepo.findById).toHaveBeenCalledWith("u-1");
      expect(sessionRepo.upsertByUserId).toHaveBeenCalledWith({
        userId: "u-1",
        orgId: "org-1",
        status: "qr",
        qrData: "qr-data-123",
      });
      expect(result).toEqual({ status: "qr", userId: "u-1", orgId: "org-1" });
    });

    it("throws NotFoundError when user is not found", async () => {
      userRepo.findById.mockResolvedValue(null);

      await expect(manager.reportQr("u-999", "qr-data")).rejects.toThrow(NotFoundError);
    });
  });

  // ── reportStatus ───────────────────────────────────────────────────────────

  describe("reportStatus(userId, status, phone?)", () => {
    it("upserts session with status and returns result", async () => {
      const user = fakeUser({ id: "u-1", orgId: "org-1" });
      userRepo.findById.mockResolvedValue(user);
      sessionRepo.upsertByUserId.mockResolvedValue(fakeSession({ status: "connected" }));

      const result = await manager.reportStatus("u-1", "connected", "+5551234");

      expect(userRepo.findById).toHaveBeenCalledWith("u-1");
      expect(sessionRepo.upsertByUserId).toHaveBeenCalledWith({
        userId: "u-1",
        orgId: "org-1",
        status: "connected",
        phone: "+5551234",
        qrData: null,
      });
      expect(result).toEqual({
        status: "connected",
        userId: "u-1",
        orgId: "org-1",
        phone: "+5551234",
      });
    });
  });
});
