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
  phone?: string;
  orgId: string;
  role?: "admin" | "user" | "super_admin";
}

export interface RegisterWithInviteDto {
  email: string;
  password?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  phone?: string | undefined;
  orgId: string;
  role: string;
}

export interface UpdateUserDto {
  email?: string | undefined;
  name?: string | undefined;
  surname?: string | undefined;
  phone?: string | null | undefined;
  role?: "admin" | "user" | "super_admin" | undefined;
  password?: string | undefined;
  orgId?: string | undefined;
}

export interface UserListItem {
  id: string;
  email: string | null;
  name: string | null;
  surname: string | null;
  phone: string | null;
  orgId: string;
  role: string;
  createdAt: string;
}

export class UserManager {
  constructor(
    private readonly repo: UserRepository,
    private readonly strategy: AuthStrategy,
  ) {}

  /** Normalize email for storage and lookup — case-insensitive, no whitespace. */
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Trim optional string fields (names, etc). */
  private trimOrNull(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  /** Normalize phone to digits-only (E.164 without +). Matches findByPhone query normalization. */
  private normalizePhone(value: string | null | undefined): string | null {
    if (value == null) return null;
    const digits = value.replace(/[^0-9]/g, "");
    return digits || null;
  }

  async register(
    dto: RegisterUserDto,
    callerRole?: string,
  ): Promise<{ user: User; role: "admin" | "user" | "super_admin" }> {
    const userCount = await this.repo.count();
    const isFirstUser = userCount === 0;

    if (!isFirstUser && callerRole !== "admin" && callerRole !== "super_admin") {
      throw new ForbiddenError("Only admins can create users");
    }

    const email = this.normalizeEmail(dto.email);
    const existing = await this.repo.findByEmail(email);
    if (existing) throw new ConflictError("User", `email '${email}'`);

    const role = isFirstUser ? "super_admin" : (dto.role ?? "user");
    const orgId = dto.orgId?.trim() || email;
    const user = await this.repo.create({
      email,
      name: this.trimOrNull(dto.name),
      surname: this.trimOrNull(dto.surname),
      orgId,
      role,
      metadata: { passwordHash: this.strategy.hashPassword!(dto.password) },
    });

    return { user, role };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; role: "admin" | "user" | "super_admin" }> {
    const normalized = this.normalizeEmail(email);
    const result = await this.strategy.authenticate({ type: "password", email: normalized, password });
    const user = await this.repo.findByEmail(this.normalizeEmail(result.email));
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
      phone: u.phone ?? null,
      orgId: u.orgId,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async create(dto: CreateUserDto): Promise<UserListItem> {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.repo.findByEmail(email);
    if (existing) throw new ConflictError("User", `email '${email}'`);

    const role = dto.role ?? "user";
    const user = await this.repo.create({
      email,
      name: this.trimOrNull(dto.name),
      surname: this.trimOrNull(dto.surname),
      orgId: dto.orgId.trim(),
      role,
      metadata: { passwordHash: this.strategy.hashPassword!(dto.password) },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
      phone: user.phone ?? null,
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
    const user = await this.repo.findByEmail(this.normalizeEmail(email));
    if (!user) return null;
    return { user, role: user.role };
  }

  async invite(dto: InviteUserDto): Promise<UserListItem> {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.repo.findByEmail(email);
    if (existing) throw new ConflictError("User", `email '${email}'`);

    const role = dto.role ?? "user";
    const user = await this.repo.create({
      email,
      phone: this.normalizePhone(dto.phone),
      orgId: dto.orgId.trim(),
      role,
      metadata: { authStrategy: "firebase" },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
      phone: user.phone ?? null,
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

    // Only super_admin can reassign org
    if (dto.orgId && scope !== "all") {
      throw new ForbiddenError("Only super_admin can change a user's organization");
    }

    // Email conflict check
    const normalizedEmail = dto.email ? this.normalizeEmail(dto.email) : undefined;
    if (normalizedEmail && normalizedEmail !== existingUser.email) {
      const existing = await this.repo.findByEmail(normalizedEmail);
      if (existing) throw new Error("Email already in use");
    }

    // Reject password update in firebase mode
    if (dto.password && !this.strategy.supportsPasswordManagement()) {
      throw new ForbiddenError("Password management is not available with Firebase authentication");
    }

    // Build update payload
    const updateData: Record<string, unknown> = {};
    if (normalizedEmail) updateData["email"] = normalizedEmail;
    if (dto.name !== undefined) updateData["name"] = this.trimOrNull(dto.name);
    if (dto.surname !== undefined) updateData["surname"] = this.trimOrNull(dto.surname);
    if (dto.phone !== undefined) updateData["phone"] = this.normalizePhone(dto.phone);
    if (dto.role) updateData["role"] = dto.role;
    if (dto.orgId) updateData["orgId"] = dto.orgId.trim();
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
      phone: updated.phone ?? null,
      orgId: updated.orgId,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async registerWithInvite(dto: RegisterWithInviteDto): Promise<{ user: User; role: string }> {
    const email = this.normalizeEmail(dto.email);
    const existing = await this.repo.findByEmail(email);
    if (existing) throw new ConflictError("User", `email '${email}'`);

    const role = (dto.role as "admin" | "user" | "super_admin") ?? "user";
    const metadata: Record<string, unknown> = {
      authStrategy: this.strategy.name,
      onboardingComplete: false,
    };
    if (dto.firstName) metadata["firstName"] = dto.firstName.trim();
    if (dto.lastName) metadata["lastName"] = dto.lastName.trim();
    if (dto.password && this.strategy.supportsPasswordManagement()) {
      metadata["passwordHash"] = this.strategy.hashPassword!(dto.password);
    }

    const user = await this.repo.create({
      email,
      name: this.trimOrNull(dto.firstName),
      surname: this.trimOrNull(dto.lastName),
      phone: this.normalizePhone(dto.phone),
      orgId: dto.orgId.trim(),
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
      phone?: string | undefined;
      password?: string | undefined;
      onboardingComplete?: boolean | undefined;
      firstName?: string | undefined;
      lastName?: string | undefined;
    },
  ): Promise<UserListItem> {
    const existingUser = await this.repo.findById(userId);
    if (!existingUser) throw new Error("User not found");

    const normalizedEmail = dto.email ? this.normalizeEmail(dto.email) : undefined;
    if (normalizedEmail && normalizedEmail !== existingUser.email) {
      const existing = await this.repo.findByEmail(normalizedEmail);
      if (existing) throw new Error("Email already in use");
    }

    // Reject password update in firebase mode
    if (dto.password && !this.strategy.supportsPasswordManagement()) {
      throw new ForbiddenError("Password management is not available with Firebase authentication");
    }

    const updateData: Record<string, unknown> = {};
    if (normalizedEmail) updateData["email"] = normalizedEmail;
    if (dto.name !== undefined) updateData["name"] = this.trimOrNull(dto.name);
    if (dto.surname !== undefined) updateData["surname"] = this.trimOrNull(dto.surname);
    if (dto.phone !== undefined) updateData["phone"] = this.normalizePhone(dto.phone);

    // Merge metadata fields
    const metadataUpdates: Record<string, unknown> = {};
    if (dto.password) metadataUpdates["passwordHash"] = this.strategy.hashPassword!(dto.password);
    if (dto.onboardingComplete !== undefined) metadataUpdates["onboardingComplete"] = dto.onboardingComplete;
    if (dto.firstName !== undefined) metadataUpdates["firstName"] = dto.firstName?.trim() ?? null;
    if (dto.lastName !== undefined) metadataUpdates["lastName"] = dto.lastName?.trim() ?? null;

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
      phone: updated.phone ?? null,
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
