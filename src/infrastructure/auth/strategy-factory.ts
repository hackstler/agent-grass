import type { AuthStrategy } from "../../domain/ports/auth-strategy.js";
import type { AuthConfig } from "../../config/auth.config.js";
import { FirebaseStrategy } from "./firebase.strategy.js";

/**
 * Creates the appropriate AuthStrategy based on config.
 * Returns null for "password" strategy (no external token verification needed).
 */
export function createAuthStrategy(config: AuthConfig): AuthStrategy | null {
  switch (config.strategy) {
    case "firebase":
      return new FirebaseStrategy(config.firebase.projectId);
    case "password":
      return null;
  }
}
