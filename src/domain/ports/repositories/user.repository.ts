import type { User, NewUser } from "../../entities/index.js";

export interface OrgUserCount {
  orgId: string | null;
  userCount: number;
  earliestCreatedAt: Date | null;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByOrg(orgId: string): Promise<User[]>;
  findFirstByOrg(orgId: string): Promise<User | null>;
  findAll(filters?: { orgId?: string; search?: string }): Promise<User[]>;
  count(): Promise<number>;
  countByOrg(): Promise<OrgUserCount[]>;
  create(data: NewUser): Promise<User>;
  delete(id: string): Promise<boolean>;
  deleteByOrg(orgId: string): Promise<void>;
}
