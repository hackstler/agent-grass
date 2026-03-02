import { eq, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { whatsappSessions } from "../db/schema.js";
import type { WhatsappSession, NewWhatsappSession } from "../db/schema.js";
import type { WhatsAppSessionRepository } from "../../domain/ports/repositories/whatsapp-session.repository.js";

export class DrizzleWhatsAppSessionRepository implements WhatsAppSessionRepository {
  async findByUserId(userId: string): Promise<WhatsappSession | null> {
    const result = await db.query.whatsappSessions.findFirst({
      where: eq(whatsappSessions.userId, userId),
    });
    return result ?? null;
  }

  async findAllActive(): Promise<Pick<WhatsappSession, "userId" | "orgId">[]> {
    return db
      .select({ userId: whatsappSessions.userId, orgId: whatsappSessions.orgId })
      .from(whatsappSessions)
      .where(ne(whatsappSessions.status, "disconnected"));
  }

  async upsertByUserId(data: NewWhatsappSession): Promise<WhatsappSession> {
    const [session] = await db
      .insert(whatsappSessions)
      .values(data)
      .onConflictDoUpdate({
        target: whatsappSessions.userId,
        set: {
          status: data.status,
          qrData: data.qrData ?? null,
          phone: data.phone ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return session!;
  }

  async updateByUserId(
    userId: string,
    data: Partial<Pick<WhatsappSession, "status" | "qrData" | "phone" | "updatedAt">>
  ): Promise<void> {
    await db
      .update(whatsappSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(whatsappSessions.userId, userId));
  }

  async create(
    data: NewWhatsappSession
  ): Promise<Pick<WhatsappSession, "id" | "userId" | "orgId" | "status">> {
    const [session] = await db
      .insert(whatsappSessions)
      .values(data)
      .returning({
        id: whatsappSessions.id,
        userId: whatsappSessions.userId,
        orgId: whatsappSessions.orgId,
        status: whatsappSessions.status,
      });
    return session!;
  }

  async deleteByOrgId(orgId: string): Promise<void> {
    await db.delete(whatsappSessions).where(eq(whatsappSessions.orgId, orgId));
  }
}
