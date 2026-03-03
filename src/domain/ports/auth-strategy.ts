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

export interface AuthStrategy {
  readonly name: string;
  verifyToken(token: string): Promise<AuthResult>;
}
