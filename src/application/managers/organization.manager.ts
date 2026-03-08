import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import type { DocumentRepository } from "../../domain/ports/repositories/document.repository.js";
import type { TopicRepository } from "../../domain/ports/repositories/topic.repository.js";
import type { WhatsAppSessionRepository } from "../../domain/ports/repositories/whatsapp-session.repository.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import type { CatalogRepository } from "../../domain/ports/repositories/catalog.repository.js";
import type { AuthStrategy } from "../../domain/ports/auth-strategy.js";
import type { Organization } from "../../domain/entities/index.js";
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from "../../domain/errors/index.js";

export interface OrgSummary {
  orgId: string;
  name: string | null;
  userCount: number;
  docCount: number;
  createdAt: string | null;
}

export interface CreateOrgDto {
  orgId: string;
  adminUsername: string;
  adminPassword: string;
  slug?: string | null | undefined;
  name?: string | null | undefined;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  nif?: string | null | undefined;
  logo?: string | null | undefined;
  vatRate?: string | null | undefined;
  currency?: string | undefined;
  features?: import("../../domain/entities/index.js").OrgFeatures | null | undefined;
}

export interface UpdateOrgDto {
  slug?: string | null | undefined;
  name?: string | null | undefined;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  nif?: string | null | undefined;
  logo?: string | null | undefined;
  vatRate?: string | null | undefined;
  currency?: string | undefined;
  features?: import("../../domain/entities/index.js").OrgFeatures | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
}

export class OrganizationManager {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly docRepo: DocumentRepository,
    private readonly topicRepo: TopicRepository,
    private readonly sessionRepo: WhatsAppSessionRepository,
    private readonly orgRepo: OrganizationRepository,
    private readonly catalogRepo: CatalogRepository,
    private readonly strategy: AuthStrategy,
  ) {}

  async list(): Promise<OrgSummary[]> {
    const userCounts = await this.userRepo.countByOrg();
    const docCounts = await this.docRepo.countByOrg();

    const docCountMap = new Map(docCounts.map((d) => [d.orgId, d.docCount]));

    // Fetch org details for names
    const orgDetails = await Promise.all(
      userCounts.map((row) => this.orgRepo.findByOrgId(row.orgId))
    );
    const orgNameMap = new Map(
      orgDetails.filter(Boolean).map((o) => [o!.orgId, o!.name])
    );

    return userCounts.map((row) => ({
      orgId: row.orgId,
      name: orgNameMap.get(row.orgId) ?? null,
      userCount: row.userCount,
      docCount: docCountMap.get(row.orgId) ?? 0,
      createdAt: row.earliestCreatedAt ? row.earliestCreatedAt.toISOString() : null,
    }));
  }

  async getByOrgId(orgId: string): Promise<Organization> {
    const org = await this.orgRepo.findByOrgId(orgId);
    if (!org) throw new NotFoundError("Organization", orgId);
    return org;
  }

  async update(orgId: string, _callerOrgId: string, data: UpdateOrgDto): Promise<Organization> {
    return this.orgRepo.update(orgId, data);
  }

  async create(dto: CreateOrgDto): Promise<{ orgId: string; admin: Record<string, unknown> }> {
    const existingOrg = await this.userRepo.findFirstByOrg(dto.orgId);
    if (existingOrg) throw new ConflictError("Organization", `orgId '${dto.orgId}'`);

    const existingUser = await this.userRepo.findByEmail(dto.adminUsername);
    if (existingUser) throw new ConflictError("User", `email '${dto.adminUsername}'`);

    // Create the organizations row
    await this.orgRepo.create({
      orgId: dto.orgId,
      slug: dto.slug,
      name: dto.name,
      address: dto.address,
      phone: dto.phone,
      email: dto.email,
      nif: dto.nif,
      logo: dto.logo,
      vatRate: dto.vatRate,
      currency: dto.currency,
      features: dto.features,
    });

    const admin = await this.userRepo.create({
      email: dto.adminUsername,
      orgId: dto.orgId,
      role: "admin",
      metadata: { passwordHash: this.strategy.hashPassword!(dto.adminPassword) },
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
    await this.catalogRepo.deleteByOrg(orgId);
    await this.docRepo.deleteByOrg(orgId);
    await this.topicRepo.deleteByOrg(orgId);
    await this.sessionRepo.deleteByOrgId(orgId);
    await this.userRepo.deleteByOrg(orgId);
    await this.orgRepo.deleteByOrgId(orgId);
  }
}
