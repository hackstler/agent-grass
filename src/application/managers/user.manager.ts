import type { User } from "../../domain/entities/index.js";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import type { AuthStrategy } from "../../domain/ports/auth-strategy.js";
import {
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from "../../domain/errors/index.js";
import { getPermissionScope, type Role } from "../../domain/permissions.js";

export interface RegisterUserDto {
  email: string;
  password: string;
  name?: string | undefined;
  surname?: string | undefined;
  orgId?: string | undefined;
  role?: "admin" | "user" | "super_admin" | undefined;
}

export interface CreateUserDto {
  email: string;
  password: string;
  name?: string | undefined;
  surname?: string | undefined;
  orgId: string;
  role?: "admin" | "user" | "super_admin" | undefined;
}

export interface InviteUserDto {
  email: string;
  orgId: string;
  role?: "admin" | "user" | "super_admin";
}

export interface RegisterWithInviteDto {
  email: string;
  password?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  orgId: string;
  role: string;
}

export interface UpdateUserDto {
  email?: string | undefined;
  name?: string | undefined;
  surname?: string | undefined;
  role?: "admin" | "user" | "super_admin" | undefined;
  password?: string | undefined;
}

export interface UserListItem {
  id: string;
  email: string | null;
  name: string | null;
  surname: string | null;
  orgId: string;
  role: string;
  createdAt: string;
}

export class UserManager {
  constructor(
    private readonly repo: UserRepository,
    private readonly strategy: AuthStrategy,
  ) {}

  async register(
    dto: RegisterUserDto,
    callerRole?: string,
  ): Promise<{ user: User; role: "admin" | "user" | "super_admin" }> {
    const userCount = await this.repo.count();
    const isFirstUser = userCount === 0;

    if (!isFirstUser && callerRole !== "admin" && callerRole !== "super_admin") {
      throw new ForbiddenError("Only admins can create users");
    }

    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictError("User", `email '${dto.email}'`);

    const role = isFirstUser ? "super_admin" : (dto.role ?? "user");
    const user = await this.repo.create({
      email: dto.email,
      name: dto.name ?? null,
      surname: dto.surname ?? null,
      orgId: dto.orgId ?? dto.email,
      role,
      metadata: { passwordHash: this.strategy.hashPassword!(dto.password) },
    });

    return { user, role };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; role: "admin" | "user" | "super_admin" }> {
    const result = await this.strategy.authenticate({ type: "password", email, password });
    const user = await this.repo.findByEmail(result.email);
    if (!user) throw new UnauthorizedError("Invalid credentials");
    return { user, role: user.role };
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
      name: u.name,
      surname: u.surname,
      orgId: u.orgId,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async create(dto: CreateUserDto): Promise<UserListItem> {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictError("User", `email '${dto.email}'`);

    const role = dto.role ?? "user";
    const user = await this.repo.create({
      email: dto.email,
      name: dto.name ?? null,
      surname: dto.surname ?? null,
      orgId: dto.orgId,
      role,
      metadata: { passwordHash: this.strategy.hashPassword!(dto.password) },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
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

  async findByEmailWithRole(
    email: string,
  ): Promise<{ user: User; role: "admin" | "user" | "super_admin" } | null> {
    const user = await this.repo.findByEmail(email);
    if (!user) return null;
    return { user, role: user.role };
  }

  async invite(dto: InviteUserDto): Promise<UserListItem> {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictError("User", `email '${dto.email}'`);

    const role = dto.role ?? "user";
    const user = await this.repo.create({
      email: dto.email,
      orgId: dto.orgId,
      role,
      metadata: { authStrategy: "firebase" },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
      orgId: user.orgId,
      role,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    callerRole: string,
    callerOrgId: string,
  ): Promise<UserListItem> {
    const scope = getPermissionScope(callerRole as Role, "edit_org_users");
    if (!scope) throw new Error("Forbidden");

    const existingUser = await this.repo.findById(id);
    if (!existingUser) throw new Error("User not found");

    // Org scoping
    if (scope === "own_org" && existingUser.orgId !== callerOrgId) {
      throw new Error("Forbidden");
    }

    // Only super_admin can assign super_admin role
    if (dto.role === "super_admin" && callerRole !== "super_admin") {
      throw new Error("Only super_admin can assign super_admin role");
    }

    // Email conflict check
    if (dto.email && dto.email !== existingUser.email) {
      const existing = await this.repo.findByEmail(dto.email);
      if (existing) throw new Error("Email already in use");
    }

    // Reject password update in firebase mode
    if (dto.password && !this.strategy.supportsPasswordManagement()) {
      throw new ForbiddenError("Password management is not available with Firebase authentication");
    }

    // Build update payload
    const updateData: Record<string, unknown> = {};
    if (dto.email) updateData["email"] = dto.email;
    if (dto.name !== undefined) updateData["name"] = dto.name;
    if (dto.surname !== undefined) updateData["surname"] = dto.surname;
    if (dto.role) updateData["role"] = dto.role;
    if (dto.password) {
      updateData["metadata"] = {
        ...(existingUser.metadata ?? {}),
        passwordHash: this.strategy.hashPassword!(dto.password),
      };
    }

    const updated = await this.repo.update(id, updateData);
    if (!updated) throw new Error("Update failed");

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      surname: updated.surname,
      orgId: updated.orgId,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async registerWithInvite(dto: RegisterWithInviteDto): Promise<{ user: User; role: string }> {
    const existing = await this.repo.findByEmail(dto.email);
    if (existing) throw new ConflictError("User", `email '${dto.email}'`);

    const role = (dto.role as "admin" | "user" | "super_admin") ?? "user";
    const metadata: Record<string, unknown> = {
      authStrategy: this.strategy.name,
      onboardingComplete: false,
    };
    if (dto.firstName) metadata["firstName"] = dto.firstName;
    if (dto.lastName) metadata["lastName"] = dto.lastName;
    if (dto.password && this.strategy.supportsPasswordManagement()) {
      metadata["passwordHash"] = this.strategy.hashPassword!(dto.password);
    }

    const user = await this.repo.create({
      email: dto.email,
      name: dto.firstName ?? null,
      surname: dto.lastName ?? null,
      orgId: dto.orgId,
      role,
      metadata,
    });

    return { user, role };
  }

  async updateSelf(
    userId: string,
    dto: {
      email?: string | undefined;
      name?: string | undefined;
      surname?: string | undefined;
      password?: string | undefined;
      onboardingComplete?: boolean | undefined;
      firstName?: string | undefined;
      lastName?: string | undefined;
    },
  ): Promise<UserListItem> {
    const existingUser = await this.repo.findById(userId);
    if (!existingUser) throw new Error("User not found");

    if (dto.email && dto.email !== existingUser.email) {
      const existing = await this.repo.findByEmail(dto.email);
      if (existing) throw new Error("Email already in use");
    }

    // Reject password update in firebase mode
    if (dto.password && !this.strategy.supportsPasswordManagement()) {
      throw new ForbiddenError("Password management is not available with Firebase authentication");
    }

    const updateData: Record<string, unknown> = {};
    if (dto.email) updateData["email"] = dto.email;
    if (dto.name !== undefined) updateData["name"] = dto.name;
    if (dto.surname !== undefined) updateData["surname"] = dto.surname;

    // Merge metadata fields
    const metadataUpdates: Record<string, unknown> = {};
    if (dto.password) metadataUpdates["passwordHash"] = this.strategy.hashPassword!(dto.password);
    if (dto.onboardingComplete !== undefined) metadataUpdates["onboardingComplete"] = dto.onboardingComplete;
    if (dto.firstName !== undefined) metadataUpdates["firstName"] = dto.firstName;
    if (dto.lastName !== undefined) metadataUpdates["lastName"] = dto.lastName;

    if (Object.keys(metadataUpdates).length > 0) {
      updateData["metadata"] = {
        ...(existingUser.metadata ?? {}),
        ...metadataUpdates,
      };
    }

    const updated = await this.repo.update(userId, updateData);
    if (!updated) throw new Error("Update failed");

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      surname: updated.surname,
      orgId: updated.orgId,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async resolveOrgId(userId: string): Promise<string> {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundError("User", userId);
    return user.orgId;
  }

  async countUsers(): Promise<number> {
    return this.repo.count();
  }
}
