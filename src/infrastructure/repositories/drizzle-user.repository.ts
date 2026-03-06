import { eq, ilike, and, count, min, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import type { User, NewUser } from "../db/schema.js";
import type { UserRepository, OrgUserCount } from "../../domain/ports/repositories/user.repository.js";

export class DrizzleUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const result = await db.query.users.findFirst({
      where: eq(users.id, id),
    });
    return result ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    return result ?? null;
  }

  async findByOrg(orgId: string): Promise<User[]> {
    return db.query.users.findMany({
      where: eq(users.orgId, orgId),
    });
  }

  async findFirstByOrg(orgId: string): Promise<User | null> {
    const result = await db.query.users.findFirst({
      where: eq(users.orgId, orgId),
    });
    return result ?? null;
  }

  async findAll(filters?: { orgId?: string; search?: string }): Promise<User[]> {
    const conditions: SQL[] = [];
    if (filters?.orgId) conditions.push(eq(users.orgId, filters.orgId));
    if (filters?.search) conditions.push(ilike(users.email, `%${filters.search}%`));

    return db
      .select()
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(users.createdAt);
  }

  async count(): Promise<number> {
    const [row] = await db.select({ id: users.id }).from(users).limit(1);
    return row ? 1 : 0;
  }

  async create(data: NewUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user!;
  }

  async countByOrg(): Promise<OrgUserCount[]> {
    const rows = await db
      .select({
        orgId: users.orgId,
        userCount: count(users.id),
        earliestCreatedAt: min(users.createdAt),
      })
      .from(users)
      .groupBy(users.orgId);

    return rows.map((r) => ({
      orgId: r.orgId,
      userCount: Number(r.userCount),
      earliestCreatedAt: r.earliestCreatedAt,
    }));
  }

  async update(id: string, data: Partial<Omit<NewUser, "orgId">>): Promise<User | null> {
    const result = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return result[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return result.length > 0;
  }

  async deleteByOrg(orgId: string): Promise<void> {
    await db.delete(users).where(eq(users.orgId, orgId));
  }
}
