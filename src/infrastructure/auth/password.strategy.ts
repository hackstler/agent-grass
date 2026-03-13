import { createHash } from "crypto";
import type { AuthStrategy, AuthResult, AuthCredentials } from "../../domain/ports/auth-strategy.js";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import { UnauthorizedError, ValidationError } from "../../domain/errors/index.js";

export class PasswordStrategy implements AuthStrategy {
  readonly name = "password" as const;

  constructor(
    private readonly salt: string,
    private readonly userRepo: UserRepository,
  ) {}

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    if (credentials.type === "token") {
      throw new ValidationError("Password strategy does not accept token credentials");
    }

    const { email, password } = credentials;
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.userRepo.findByEmail(normalizedEmail);
    if (!user) throw new UnauthorizedError("Invalid credentials");

    const meta = user.metadata as { passwordHash?: string } | null;
    if (!meta?.passwordHash || meta.passwordHash !== this.hashPassword(password)) {
      throw new UnauthorizedError("Invalid credentials");
    }

    return { email: user.email! };
  }

  supportsPasswordManagement(): boolean {
    return true;
  }

  hashPassword(password: string): string {
    return createHash("sha256").update(`${this.salt}:${password.trim()}`).digest("hex");
  }
}
