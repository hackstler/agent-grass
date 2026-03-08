import type { WhatsappSession } from "../../domain/entities/index.js";
import type { WhatsAppSessionRepository, WhatsAppSessionWithUser } from "../../domain/ports/repositories/whatsapp-session.repository.js";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import { NotFoundError, ConflictError } from "../../domain/errors/index.js";

export class WhatsAppManager {
  constructor(
    private readonly sessionRepo: WhatsAppSessionRepository,
    private readonly userRepo: UserRepository
  ) {}

  async getStatusForUser(
    userId: string
  ): Promise<{ status: string; phone: string | null; linkingMethod?: string; pairingCode?: string | null; updatedAt?: string }> {
    const session = await this.sessionRepo.findByUserId(userId);
    if (!session) return { status: "not_enabled", phone: null };
    return {
      status: session.status,
      phone: session.phone,
      linkingMethod: session.linkingMethod,
      pairingCode: session.pairingCode,
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  async getQrForUser(userId: string): Promise<{ qrData: string }> {
    const session = await this.sessionRepo.findByUserId(userId);
    if (!session || session.status !== "qr" || !session.qrData) {
      throw new NotFoundError("QR code", userId);
    }
    return { qrData: session.qrData };
  }

  async enableForUser(
    userId: string,
    orgId: string,
    linkingMethod?: string,
    phoneNumber?: string,
  ): Promise<Pick<WhatsappSession, "id" | "userId" | "orgId" | "status">> {
    const existing = await this.sessionRepo.findByUserId(userId);

    if (existing && existing.status !== "disconnected") {
      throw new ConflictError("WhatsApp session", `userId '${userId}'`);
    }

    const method = linkingMethod ?? "qr";

    if (existing) {
      await this.sessionRepo.updateByUserId(userId, {
        status: "pending",
        qrData: null,
        phone: null,
        linkingMethod: method,
        pairingCode: null,
        phoneNumber: phoneNumber ?? null,
      });
      return { id: existing.id, userId, orgId, status: "pending" };
    }

    return this.sessionRepo.create({ userId, orgId, status: "pending", linkingMethod: method, phoneNumber: phoneNumber ?? null });
  }

  async getPairingCodeForUser(userId: string): Promise<{ pairingCode: string }> {
    const session = await this.sessionRepo.findByUserId(userId);
    if (!session || session.status !== "code" || !session.pairingCode) {
      throw new NotFoundError("Pairing code", userId);
    }
    return { pairingCode: session.pairingCode };
  }

  async disconnectForUser(userId: string): Promise<void> {
    const existing = await this.sessionRepo.findByUserId(userId);
    if (!existing) throw new NotFoundError("WhatsApp session", userId);

    await this.sessionRepo.updateByUserId(userId, {
      status: "disconnected",
      qrData: null,
      phone: null,
    });
  }

  async listActiveSessions(): Promise<Pick<WhatsappSession, "userId" | "orgId" | "linkingMethod" | "phoneNumber">[]> {
    return this.sessionRepo.findAllActive();
  }

  async listAllSessions(): Promise<WhatsAppSessionWithUser[]> {
    return this.sessionRepo.findAllWithUser();
  }

  async listSessionsByOrg(orgId: string): Promise<WhatsAppSessionWithUser[]> {
    return this.sessionRepo.findAllWithUserByOrg(orgId);
  }

  async reportQr(userId: string, qrData: string): Promise<{ status: string; userId: string; orgId: string }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    await this.sessionRepo.upsertByUserId({
      userId,
      orgId: user.orgId!,
      status: "qr",
      qrData,
    });

    return { status: "qr", userId, orgId: user.orgId! };
  }

  async reportPairingCode(userId: string, code: string): Promise<{ status: string; userId: string; orgId: string }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    await this.sessionRepo.upsertByUserId({
      userId,
      orgId: user.orgId!,
      status: "code",
      pairingCode: code,
      qrData: null,
    });

    return { status: "code", userId, orgId: user.orgId! };
  }

  async reportStatus(
    userId: string,
    status: "connected" | "disconnected",
    phone?: string
  ): Promise<{ status: string; userId: string; orgId: string; phone: string | null }> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundError("User", userId);

    await this.sessionRepo.upsertByUserId({
      userId,
      orgId: user.orgId!,
      status,
      phone: phone ?? null,
      qrData: null,
    });

    return { status, userId, orgId: user.orgId!, phone: phone ?? null };
  }

  async resolveOrgId(userId: string): Promise<string> {
    const user = await this.userRepo.findById(userId);
    if (!user?.orgId) throw new NotFoundError("User", userId);
    return user.orgId;
  }
}
