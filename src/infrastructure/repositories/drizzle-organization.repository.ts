import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizations } from "../db/schema.js";
import type { NewOrganization } from "../db/schema.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import type { Organization } from "../../domain/entities/index.js";
import { NotFoundError } from "../../domain/errors/index.js";

export class DrizzleOrganizationRepository implements OrganizationRepository {
  async findAll(): Promise<Organization[]> {
    return db.query.organizations.findMany();
  }

  async findByOrgId(orgId: string): Promise<Organization | null> {
    const result = await db.query.organizations.findFirst({
      where: eq(organizations.orgId, orgId),
    });
    return result ?? null;
  }

  async create(data: NewOrganization): Promise<Organization> {
    const [org] = await db.insert(organizations).values(data).returning();
    return org!;
  }

  async update(orgId: string, data: Partial<Omit<NewOrganization, "orgId">>): Promise<Organization> {
    const rows = await db
      .update(organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizations.orgId, orgId))
      .returning();

    if (rows.length === 0) {
      throw new NotFoundError("Organization", orgId);
    }
    return rows[0]!;
  }

  async deleteByOrgId(orgId: string): Promise<void> {
    await db.delete(organizations).where(eq(organizations.orgId, orgId));
  }
}
