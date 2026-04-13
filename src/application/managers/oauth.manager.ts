import type { OAuthTokenRepository } from "../../domain/ports/repositories/oauth-token.repository.js";
import type { TokenEncryption } from "../../domain/ports/token-encryption.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export class OAuthManager {
  constructor(
    private readonly tokenRepo: OAuthTokenRepository,
    private readonly crypto: TokenEncryption,
  ) {}

  getAuthorizeUrl(userId: string, frontendUrl?: string): string {
    const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
    const redirectUri = process.env["GOOGLE_OAUTH_REDIRECT_URI"];
    if (!clientId || !redirectUri) {
      throw new Error(
        "Google OAuth not configured (missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_REDIRECT_URI)"
      );
    }

    const state = Buffer.from(JSON.stringify({ userId, frontendUrl })).toString("base64url");

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: DEFAULT_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(
    code: string,
    state: string
  ): Promise<{ userId: string; frontendUrl?: string | undefined }> {
    const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"]!;
    const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"]!;
    const redirectUri = process.env["GOOGLE_OAUTH_REDIRECT_URI"]!;

    const parsed = JSON.parse(Buffer.from(state, "base64url").toString()) as {
      userId: string;
      frontendUrl?: string;
    };

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Google token exchange failed: ${res.status} ${errBody}`);
    }

    const tokens = (await res.json()) as TokenResponse;

    await this.tokenRepo.upsert({
      userId: parsed.userId,
      provider: "google",
      accessTokenEncrypted: this.crypto.encrypt(tokens.access_token),
      refreshTokenEncrypted: this.crypto.encrypt(tokens.refresh_token ?? ""),
      tokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope,
    });

    return { userId: parsed.userId, frontendUrl: parsed.frontendUrl };
  }

  async getStatus(userId: string): Promise<{ connected: boolean; scopes: string[] }> {
    const token = await this.tokenRepo.findByUserAndProvider(userId, "google");
    if (!token) return { connected: false, scopes: [] };
    return {
      connected: true,
      scopes: token.scopes.split(" ").filter(Boolean),
    };
  }

  async disconnect(userId: string): Promise<void> {
    const token = await this.tokenRepo.findByUserAndProvider(userId, "google");
    if (token) {
      // Best-effort revoke
      try {
        const accessToken = this.crypto.decrypt(token.accessTokenEncrypted);
        await fetch(`${GOOGLE_REVOKE_URL}?token=${accessToken}`, { method: "POST" });
      } catch {
        // Ignore revoke errors
      }
      await this.tokenRepo.deleteByUserAndProvider(userId, "google");
    }
  }

  async getAccessToken(userId: string, _scopes: string[]): Promise<string> {
    const token = await this.tokenRepo.findByUserAndProvider(userId, "google");
    if (!token) {
      throw new Error(
        "Google account not connected. Please connect your Google account in Settings."
      );
    }

    // If token is still valid (with 5-min buffer), return it
    if (token.tokenExpiry && token.tokenExpiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return this.crypto.decrypt(token.accessTokenEncrypted);
    }

    // Refresh the token
    const refreshToken = this.crypto.decrypt(token.refreshTokenEncrypted);
    if (!refreshToken) {
      throw new Error("No refresh token available. Please reconnect your Google account.");
    }

    const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"]!;
    const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"]!;

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Google token refresh failed: ${res.status} ${errBody}`);
    }

    const tokens = (await res.json()) as TokenResponse;

    await this.tokenRepo.upsert({
      userId,
      provider: "google",
      accessTokenEncrypted: this.crypto.encrypt(tokens.access_token),
      refreshTokenEncrypted: tokens.refresh_token
        ? this.crypto.encrypt(tokens.refresh_token)
        : token.refreshTokenEncrypted,
      tokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope || token.scopes,
    });

    return tokens.access_token;
  }
}
