import jwt from "jsonwebtoken";
import type { AuthStrategy, AuthResult, AuthCredentials } from "../../domain/ports/auth-strategy.js";
import { ValidationError } from "../../domain/errors/index.js";

const { verify, decode } = jwt;

const GOOGLE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}

let certCache: CertCache | null = null;

async function fetchPublicKeys(): Promise<Record<string, string>> {
  if (certCache && Date.now() < certCache.expiresAt) {
    return certCache.certs;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google public keys: ${res.status}`);
  }

  const certs = (await res.json()) as Record<string, string>;

  // Parse Cache-Control max-age for TTL
  const cacheControl = res.headers.get("cache-control") ?? "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch?.[1] ? parseInt(maxAgeMatch[1], 10) : 3600;

  certCache = {
    certs,
    expiresAt: Date.now() + maxAgeSec * 1000,
  };

  return certs;
}

export class FirebaseStrategy implements AuthStrategy {
  readonly name = "firebase" as const;
  private readonly projectId: string;

  constructor(projectId: string) {
    if (!projectId) {
      throw new Error("FIREBASE_PROJECT_ID is required when AUTH_STRATEGY=firebase");
    }
    this.projectId = projectId;
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    if (credentials.type === "password") {
      throw new ValidationError("Firebase does not accept password credentials");
    }

    return this.verifyToken(credentials.token);
  }

  supportsPasswordManagement(): boolean {
    return false;
  }

  private async verifyToken(token: string): Promise<AuthResult> {
    // Decode header to get kid
    const decoded = decode(token, { complete: true });
    if (!decoded || typeof decoded === "string") {
      throw new Error("Invalid Firebase ID token: cannot decode");
    }

    const { header, payload } = decoded;
    if (header.alg !== "RS256") {
      throw new Error(`Invalid Firebase ID token: expected alg RS256, got ${header.alg}`);
    }

    const kid = header.kid;
    if (!kid) {
      throw new Error("Invalid Firebase ID token: missing kid in header");
    }

    // Fetch Google public keys and find the matching cert
    const certs = await fetchPublicKeys();
    const cert = certs[kid];
    if (!cert) {
      throw new Error("Invalid Firebase ID token: kid not found in Google public keys");
    }

    // Verify signature and standard claims (exp, iat)
    const verified = verify(token, cert, {
      algorithms: ["RS256"],
      issuer: `https://securetoken.google.com/${this.projectId}`,
      audience: this.projectId,
    }) as Record<string, unknown>;

    // Validate Firebase-specific claims
    const sub = verified["sub"];
    if (typeof sub !== "string" || !sub) {
      throw new Error("Invalid Firebase ID token: sub claim is empty");
    }

    const authTime = verified["auth_time"];
    if (typeof authTime !== "number") {
      throw new Error("Invalid Firebase ID token: missing auth_time");
    }

    // auth_time must be in the past
    if (authTime > Math.floor(Date.now() / 1000)) {
      throw new Error("Invalid Firebase ID token: auth_time is in the future");
    }

    const email = verified["email"];
    if (typeof email !== "string" || !email) {
      throw new Error("Invalid Firebase ID token: missing email claim");
    }

    return {
      email,
      externalUid: sub,
      emailVerified: verified["email_verified"] === true,
    };
  }
}
