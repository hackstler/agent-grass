import { createHash, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
const { sign, verify } = jwt;
import type { Invitation } from "../../domain/entities/index.js";
import type { InvitationRepository } from "../../domain/ports/repositories/invitation.repository.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import {
  NotFoundError,
  ValidationError,
} from "../../domain/errors/index.js";

export interface InvitationTokenPayload {
  type: "invitation";
  invitationId: string;
  orgId: string;
  role: string;
  email?: string;
}

export class InvitationManager {
  constructor(
    private readonly repo: InvitationRepository,
    private readonly orgRepo: OrganizationRepository,
    private readonly jwtSecret: string,
  ) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async createInvitation(
    orgId: string,
    role: string,
    email: string | null | undefined,
    callerUserId: string,
  ): Promise<{ invitation: Invitation; token: string }> {
    const invitationId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const normalizedEmail = email?.trim().toLowerCase() || null;

    const payload: InvitationTokenPayload = {
      type: "invitation",
      invitationId,
      orgId,
      role,
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
    };

    const token = sign(payload, this.jwtSecret, { expiresIn: "7d" } as jwt.SignOptions);
    const tokenHash = this.hashToken(token);

    const invitation = await this.repo.create({
      id: invitationId,
      orgId,
      role,
      email: normalizedEmail,
      tokenHash,
      createdBy: callerUserId,
      expiresAt,
    });

    return { invitation, token };
  }

  async validateToken(token: string): Promise<{
    valid: true;
    invitation: Invitation;
    orgId: string;
    orgName: string | null;
    role: string;
    email: string | null;
  } | {
    valid: false;
    reason: "expired" | "used" | "invalid";
  }> {
    // 1. Verify JWT signature
    let payload: InvitationTokenPayload;
    try {
      payload = verify(token, this.jwtSecret) as InvitationTokenPayload;
    } catch {
      return { valid: false, reason: "invalid" };
    }

    if (payload.type !== "invitation") {
      return { valid: false, reason: "invalid" };
    }

    // 2. Find in DB by hash
    const tokenHash = this.hashToken(token);
    const invitation = await this.repo.findByTokenHash(tokenHash);
    if (!invitation) {
      return { valid: false, reason: "invalid" };
    }

    // 3. Check if already used
    if (invitation.usedAt) {
      return { valid: false, reason: "used" };
    }

    // 4. Check expiry
    if (invitation.expiresAt < new Date()) {
      return { valid: false, reason: "expired" };
    }

    // 5. Fetch org name
    let orgName: string | null = null;
    try {
      const org = await this.orgRepo.findByOrgId(invitation.orgId);
      orgName = org?.name ?? null;
    } catch {
      // org may not exist in the organizations table yet
    }

    return {
      valid: true,
      invitation,
      orgId: invitation.orgId,
      orgName,
      role: invitation.role,
      email: invitation.email,
    };
  }

  async markUsed(invitationId: string, userId: string): Promise<void> {
    const updated = await this.repo.markUsed(invitationId, userId);
    if (!updated) {
      throw new NotFoundError("Invitation", invitationId);
    }
  }

  async listByOrg(orgId: string): Promise<Invitation[]> {
    return this.repo.findByOrg(orgId);
  }

  async revoke(invitationId: string): Promise<void> {
    const deleted = await this.repo.delete(invitationId);
    if (!deleted) {
      throw new NotFoundError("Invitation", invitationId);
    }
  }
}
