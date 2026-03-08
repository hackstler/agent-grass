import type { WhatsappSession, NewWhatsappSession } from "../../entities/index.js";

export interface WhatsAppSessionWithUser {
  id: string;
  orgId: string;
  userId: string;
  status: string;
  phone: string | null;
  updatedAt: Date;
  userEmail: string | null;
}

export interface WhatsAppSessionRepository {
  findByUserId(userId: string): Promise<WhatsappSession | null>;
  findAllActive(): Promise<Pick<WhatsappSession, "userId" | "orgId" | "linkingMethod" | "phoneNumber">[]>;
  findAllWithUser(): Promise<WhatsAppSessionWithUser[]>;
  findAllWithUserByOrg(orgId: string): Promise<WhatsAppSessionWithUser[]>;
  upsertByUserId(data: NewWhatsappSession): Promise<WhatsappSession>;
  updateByUserId(
    userId: string,
    data: Partial<Pick<WhatsappSession, "status" | "qrData" | "phone" | "updatedAt" | "pairingCode" | "phoneNumber" | "linkingMethod">>
  ): Promise<void>;
  create(data: NewWhatsappSession): Promise<Pick<WhatsappSession, "id" | "userId" | "orgId" | "status">>;
  deleteByOrgId(orgId: string): Promise<void>;
}
