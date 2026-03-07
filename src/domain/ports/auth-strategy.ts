/**
 * Auth strategy port — allows pluggable authentication backends.
 *
 * Implementations live in infrastructure/auth/.
 * The application layer depends only on this interface.
 */

export interface AuthResult {
  email: string;
  externalUid?: string;
  emailVerified?: boolean;
}

export type AuthCredentials =
  | { type: "token"; token: string }
  | { type: "password"; email: string; password: string };

export interface AuthStrategy {
  readonly name: "password" | "firebase";
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  supportsPasswordManagement(): boolean;
  hashPassword?(password: string): string;
}
