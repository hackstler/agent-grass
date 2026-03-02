import type { WhatsappSession } from "../../domain/entities/index.js";
import type { WhatsAppSessionRepository } from "../../domain/ports/repositories/whatsapp-session.repository.js";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import { NotFoundError, ConflictError } from "../../domain/errors/index.js";

export class WhatsAppManager {
  constructor(
    private readonly sessionRepo: WhatsAppSessionRepository,
    private readonly userRepo: UserRepository
  ) {}

  async getStatusForUser(
    userId: string
  ): Promise<{ status: string; phone: string | null; updatedAt?: string }> {
    const session = await this.sessionRepo.findByUserId(userId);
    if (!session) return { status: "not_enabled", phone: null };
    return {
      status: session.status,
      phone: session.phone,
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
    orgId: string
  ): Promise<Pick<WhatsappSession, "id" | "userId" | "orgId" | "status">> {
    const existing = await this.sessionRepo.findByUserId(userId);
    if (existing) throw new ConflictError("WhatsApp session", `userId '${userId}'`);

    return this.sessionRepo.create({ userId, orgId, status: "pending" });
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

  async listActiveSessions(): Promise<Pick<WhatsappSession, "userId" | "orgId">[]> {
    return this.sessionRepo.findAllActive();
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
