import { eq, ne, and, lt, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { whatsappSessions, users } from "../db/schema.js";
import type { WhatsappSession, NewWhatsappSession } from "../db/schema.js";
import type { WhatsAppSessionRepository, WhatsAppSessionWithUser } from "../../domain/ports/repositories/whatsapp-session.repository.js";

export class DrizzleWhatsAppSessionRepository implements WhatsAppSessionRepository {
  async findByUserId(userId: string): Promise<WhatsappSession | null> {
    const result = await db.query.whatsappSessions.findFirst({
      where: eq(whatsappSessions.userId, userId),
    });
    return result ?? null;
  }

  async findAllActive(): Promise<Pick<WhatsappSession, "userId" | "orgId" | "linkingMethod" | "phoneNumber">[]> {
    // Auto-disconnect stale sessions: qr/pending not updated in 5 minutes are zombies.
    // This prevents zombie sessions from filling MAX_SESSIONS and blocking new connections.
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
    await db
      .update(whatsappSessions)
      .set({ status: "disconnected", qrData: null, updatedAt: new Date() })
      .where(
        and(
          inArray(whatsappSessions.status, ["qr", "pending", "code"]),
          lt(whatsappSessions.updatedAt, staleThreshold),
        ),
      );

    return db
      .select({
        userId: whatsappSessions.userId,
        orgId: whatsappSessions.orgId,
        linkingMethod: whatsappSessions.linkingMethod,
        phoneNumber: whatsappSessions.phoneNumber,
      })
      .from(whatsappSessions)
      .where(ne(whatsappSessions.status, "disconnected"));
  }

  async findAllWithUser(): Promise<WhatsAppSessionWithUser[]> {
    const rows = await db
      .select({
        id: whatsappSessions.id,
        orgId: whatsappSessions.orgId,
        userId: whatsappSessions.userId,
        status: whatsappSessions.status,
        phone: whatsappSessions.phone,
        updatedAt: whatsappSessions.updatedAt,
        userEmail: users.email,
      })
      .from(whatsappSessions)
      .innerJoin(users, eq(whatsappSessions.userId, users.id));
    return rows;
  }

  async findAllWithUserByOrg(orgId: string): Promise<WhatsAppSessionWithUser[]> {
    const rows = await db
      .select({
        id: whatsappSessions.id,
        orgId: whatsappSessions.orgId,
        userId: whatsappSessions.userId,
        status: whatsappSessions.status,
        phone: whatsappSessions.phone,
        updatedAt: whatsappSessions.updatedAt,
        userEmail: users.email,
      })
      .from(whatsappSessions)
      .innerJoin(users, eq(whatsappSessions.userId, users.id))
      .where(eq(whatsappSessions.orgId, orgId));
    return rows;
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
          linkingMethod: data.linkingMethod ?? "qr",
          pairingCode: data.pairingCode ?? null,
          phoneNumber: data.phoneNumber ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return session!;
  }

  async updateByUserId(
    userId: string,
    data: Partial<Pick<WhatsappSession, "status" | "qrData" | "phone" | "updatedAt" | "pairingCode" | "phoneNumber" | "linkingMethod">>
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
