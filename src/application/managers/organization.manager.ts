import { createHash } from "crypto";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import type { DocumentRepository } from "../../domain/ports/repositories/document.repository.js";
import type { TopicRepository } from "../../domain/ports/repositories/topic.repository.js";
import type { WhatsAppSessionRepository } from "../../domain/ports/repositories/whatsapp-session.repository.js";
import { NotFoundError, ConflictError, ValidationError } from "../../domain/errors/index.js";

export interface OrgSummary {
  orgId: string;
  userCount: number;
  docCount: number;
  createdAt: string | null;
}

export interface CreateOrgDto {
  orgId: string;
  adminUsername: string;
  adminPassword: string;
}

export class OrganizationManager {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly docRepo: DocumentRepository,
    private readonly topicRepo: TopicRepository,
    private readonly sessionRepo: WhatsAppSessionRepository,
    private readonly passwordSalt: string,
  ) {}

  private hashPassword(password: string): string {
    return createHash("sha256").update(`${this.passwordSalt}:${password}`).digest("hex");
  }

  async list(): Promise<OrgSummary[]> {
    const userCounts = await this.userRepo.countByOrg();
    const docCounts = await this.docRepo.countByOrg();

    const docCountMap = new Map(docCounts.map((d) => [d.orgId, d.docCount]));

    return userCounts.map((row) => ({
      orgId: row.orgId,
      userCount: row.userCount,
      docCount: docCountMap.get(row.orgId) ?? 0,
      createdAt: row.earliestCreatedAt ? row.earliestCreatedAt.toISOString() : null,
    }));
  }

  async create(dto: CreateOrgDto): Promise<{ orgId: string; admin: Record<string, unknown> }> {
    const existingOrg = await this.userRepo.findFirstByOrg(dto.orgId);
    if (existingOrg) throw new ConflictError("Organization", `orgId '${dto.orgId}'`);

    const existingUser = await this.userRepo.findByEmail(dto.adminUsername);
    if (existingUser) throw new ConflictError("User", `email '${dto.adminUsername}'`);

    const admin = await this.userRepo.create({
      email: dto.adminUsername,
      orgId: dto.orgId,
      role: "admin",
      metadata: { passwordHash: this.hashPassword(dto.adminPassword) },
    });

    return {
      orgId: dto.orgId,
      admin: {
        id: admin.id,
        email: admin.email,
        orgId: admin.orgId,
        role: "admin",
        createdAt: admin.createdAt.toISOString(),
      },
    };
  }

  async delete(orgId: string, callerOrgId: string): Promise<void> {
    if (callerOrgId === orgId) {
      throw new ValidationError("Cannot delete your own organization");
    }

    const orgExists = await this.userRepo.findFirstByOrg(orgId);
    if (!orgExists) throw new NotFoundError("Organization", orgId);

    // Cascade delete in order (documents cascade chunks via FK)
    await this.docRepo.deleteByOrg(orgId);
    await this.topicRepo.deleteByOrg(orgId);
    await this.sessionRepo.deleteByOrgId(orgId);
    await this.userRepo.deleteByOrg(orgId);
  }
}
