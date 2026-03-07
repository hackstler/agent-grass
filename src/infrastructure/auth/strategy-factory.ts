import type { AuthStrategy } from "../../domain/ports/auth-strategy.js";
import type { AuthConfig } from "../../config/auth.config.js";
import type { UserRepository } from "../../domain/ports/repositories/user.repository.js";
import { FirebaseStrategy } from "./firebase.strategy.js";
import { PasswordStrategy } from "./password.strategy.js";

/**
 * Creates the appropriate AuthStrategy based on config.
 * Always returns a concrete strategy (never null).
 */
export function createAuthStrategy(
  config: AuthConfig,
  salt: string,
  userRepo: UserRepository,
): AuthStrategy {
  switch (config.strategy) {
    case "firebase":
      return new FirebaseStrategy(config.firebase.projectId);
    case "password":
      return new PasswordStrategy(salt, userRepo);
  }
}
