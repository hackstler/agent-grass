import type { WhatsappSession, NewWhatsappSession } from "../../entities/index.js";

export interface WhatsAppSessionRepository {
  findByUserId(userId: string): Promise<WhatsappSession | null>;
  findAllActive(): Promise<Pick<WhatsappSession, "userId" | "orgId">[]>;
  upsertByUserId(data: NewWhatsappSession): Promise<WhatsappSession>;
  updateByUserId(
    userId: string,
    data: Partial<Pick<WhatsappSession, "status" | "qrData" | "phone" | "updatedAt">>
  ): Promise<void>;
  create(data: NewWhatsappSession): Promise<Pick<WhatsappSession, "id" | "userId" | "orgId" | "status">>;
  deleteByOrgId(orgId: string): Promise<void>;
}
