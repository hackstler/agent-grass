import { createHash } from "crypto";
import type { User } from "../../domain/entities/index.js";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import {
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from "../../domain/errors/index.js";

export interface RegisterUserDto {
  username: string;
  password: string;
  orgId?: string;
  role?: "admin" | "user";
}

export interface CreateUserDto {
  username: string;
  password: string;
  orgId: string;
  role?: "admin" | "user";
}

export interface UserListItem {
  id: string;
  email: string | null;
  orgId: string | null;
  role: string;
  createdAt: string;
}

export class UserManager {
  constructor(
    private readonly repo: UserRepository,
    private readonly passwordSalt: string,
  ) {}

  private hashPassword(password: string): string {
    return createHash("sha256").update(`${this.passwordSalt}:${password}`).digest("hex");
  }

  async register(
    dto: RegisterUserDto,
    callerRole?: string,
  ): Promise<{ user: User; role: "admin" | "user" }> {
    const userCount = await this.repo.count();
    const isFirstUser = userCount === 0;

    if (!isFirstUser && callerRole !== "admin") {
      throw new ForbiddenError("Only admins can create users");
    }

    const existing = await this.repo.findByEmail(dto.username);
    if (existing) throw new ConflictError("User", `email '${dto.username}'`);

    const role = isFirstUser ? "admin" : (dto.role ?? "user");
    const user = await this.repo.create({
      email: dto.username,
      orgId: dto.orgId ?? dto.username,
      metadata: { passwordHash: this.hashPassword(dto.password), role },
    });

    return { user, role };
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ user: User; role: "admin" | "user" }> {
    const user = await this.repo.findByEmail(username);
    if (!user) throw new UnauthorizedError("Invalid credentials");

    const meta = user.metadata as { passwordHash?: string; role?: string } | null;
    if (!meta?.passwordHash || meta.passwordHash !== this.hashPassword(password)) {
      throw new UnauthorizedError("Invalid credentials");
    }

    return { user, role: (meta.role ?? "user") as "admin" | "user" };
  }

  async getById(id: string): Promise<User> {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundError("User", id);
    return user;
  }

  async listAll(filters?: { orgId?: string; search?: string }): Promise<UserListItem[]> {
    const users = await this.repo.findAll(filters);
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      orgId: u.orgId,
      role: ((u.metadata as Record<string, unknown> | null)?.["role"] as string) ?? "user",
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async create(dto: CreateUserDto): Promise<UserListItem> {
    const existing = await this.repo.findByEmail(dto.username);
    if (existing) throw new ConflictError("User", `email '${dto.username}'`);

    const role = dto.role ?? "user";
    const user = await this.repo.create({
      email: dto.username,
      orgId: dto.orgId,
      metadata: { passwordHash: this.hashPassword(dto.password), role },
    });

    return {
      id: user.id,
      email: user.email,
      orgId: user.orgId,
      role,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async delete(id: string, callerId: string): Promise<void> {
    if (id === callerId) {
      throw new ValidationError("Cannot delete your own account");
    }
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundError("User", id);
  }

  async resolveOrgId(userId: string): Promise<string> {
    const user = await this.repo.findById(userId);
    if (!user?.orgId) throw new NotFoundError("User", userId);
    return user.orgId;
  }

  async countUsers(): Promise<number> {
    return this.repo.count();
  }
}
