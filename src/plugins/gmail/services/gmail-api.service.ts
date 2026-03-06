import type { OAuthTokenProvider } from "../../google-common/oauth-token-provider.js";
import { gmailConfig } from "../config/gmail.config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailEmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface GmailEmailFull {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  labelIds: string[];
}

export interface GmailSendResult {
  success: boolean;
  messageId: string;
  threadId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiObject = Record<string, any>;

function toBase64Url(str: string): string {
  return Buffer.from(str).toString("base64url");
}

function fromBase64Url(str: string): string {
  return Buffer.from(str, "base64url").toString("utf-8");
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function buildPlainMessage(to: string, subject: string, body: string): string {
  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
}

function buildMultipartMessage(
  to: string,
  subject: string,
  body: string,
  attachment: { base64: string; mimetype: string; filename: string },
): string {
  const boundary = `__boundary_${Date.now()}_${Math.random().toString(36).slice(2)}__`;

  // Break base64 into 76-char lines per RFC 2045
  const base64Lines = attachment.base64.replace(/(.{76})/g, "$1\r\n");

  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
    `--${boundary}`,
    `Content-Type: ${attachment.mimetype}`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    base64Lines,
    `--${boundary}--`,
  ].join("\r\n");
}

function extractTextBody(payload: ApiObject): string {
  if (payload["mimeType"] === "text/plain") {
    const bodyData = payload["body"]?.["data"];
    if (bodyData) {
      return fromBase64Url(String(bodyData));
    }
  }

  const parts = payload["parts"] as ApiObject[] | undefined;
  if (parts) {
    for (const part of parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailApiService {
  private readonly tokenProvider: OAuthTokenProvider;

  constructor(tokenProvider: OAuthTokenProvider) {
    this.tokenProvider = tokenProvider;
  }

  private async getAuthHeaders(userId: string): Promise<Record<string, string>> {
    const token = await this.tokenProvider.getAccessToken(userId, [...gmailConfig.scopes]);
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  // -----------------------------------------------------------------------
  // listEmails
  // -----------------------------------------------------------------------

  async listEmails(userId: string, maxResults?: number): Promise<GmailEmailSummary[]> {
    const headers = await this.getAuthHeaders(userId);
    const limit = maxResults ?? gmailConfig.maxResults;

    const listParams = new URLSearchParams({
      maxResults: String(limit),
      q: "in:inbox",
    });

    const listResponse = await fetch(`${BASE_URL}/messages?${listParams.toString()}`, { headers });

    if (!listResponse.ok) {
      const errorBody = await listResponse.text();
      throw new Error(`Gmail list API error (${listResponse.status}): ${errorBody}`);
    }

    const listData = (await listResponse.json()) as ApiObject;
    const messageRefs = (listData["messages"] as Array<{ id: string; threadId: string }>) ?? [];

    if (messageRefs.length === 0) return [];

    return this.fetchMessageSummaries(messageRefs, headers);
  }

  // -----------------------------------------------------------------------
  // readEmail
  // -----------------------------------------------------------------------

  async readEmail(userId: string, messageId: string): Promise<GmailEmailFull> {
    const headers = await this.getAuthHeaders(userId);

    const response = await fetch(`${BASE_URL}/messages/${messageId}?format=full`, { headers });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gmail get message API error (${response.status}): ${errorBody}`);
    }

    const msg = (await response.json()) as ApiObject;
    const payload = (msg["payload"] ?? {}) as ApiObject;
    const msgHeaders = (payload["headers"] ?? []) as Array<{ name: string; value: string }>;

    return {
      id: String(msg["id"] ?? ""),
      threadId: String(msg["threadId"] ?? ""),
      subject: getHeader(msgHeaders, "Subject"),
      from: getHeader(msgHeaders, "From"),
      to: getHeader(msgHeaders, "To"),
      date: getHeader(msgHeaders, "Date"),
      body: extractTextBody(payload),
      labelIds: (msg["labelIds"] as string[]) ?? [],
    };
  }

  // -----------------------------------------------------------------------
  // sendEmail
  // -----------------------------------------------------------------------

  async sendEmail(
    userId: string,
    to: string,
    subject: string,
    body: string,
    attachment?: { base64: string; mimetype: string; filename: string },
  ): Promise<GmailSendResult> {
    const headers = await this.getAuthHeaders(userId);

    const rawMessage = attachment
      ? buildMultipartMessage(to, subject, body, attachment)
      : buildPlainMessage(to, subject, body);

    const encodedMessage = toBase64Url(rawMessage);

    const response = await fetch(`${BASE_URL}/messages/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gmail send API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as ApiObject;

    return {
      success: true,
      messageId: String(data["id"] ?? ""),
      threadId: String(data["threadId"] ?? ""),
    };
  }

  // -----------------------------------------------------------------------
  // searchEmails
  // -----------------------------------------------------------------------

  async searchEmails(userId: string, query: string, maxResults?: number): Promise<GmailEmailSummary[]> {
    const headers = await this.getAuthHeaders(userId);
    const limit = maxResults ?? gmailConfig.maxResults;

    const listParams = new URLSearchParams({
      maxResults: String(limit),
      q: query,
    });

    const listResponse = await fetch(`${BASE_URL}/messages?${listParams.toString()}`, { headers });

    if (!listResponse.ok) {
      const errorBody = await listResponse.text();
      throw new Error(`Gmail search API error (${listResponse.status}): ${errorBody}`);
    }

    const listData = (await listResponse.json()) as ApiObject;
    const messageRefs = (listData["messages"] as Array<{ id: string; threadId: string }>) ?? [];

    if (messageRefs.length === 0) return [];

    return this.fetchMessageSummaries(messageRefs, headers);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async fetchMessageSummaries(
    messageRefs: Array<{ id: string; threadId: string }>,
    headers: Record<string, string>,
  ): Promise<GmailEmailSummary[]> {
    const summaries: GmailEmailSummary[] = [];

    for (const ref of messageRefs) {
      const metaParams = new URLSearchParams({
        format: "metadata",
        metadataHeaders: "Subject",
      });
      metaParams.append("metadataHeaders", "From");
      metaParams.append("metadataHeaders", "Date");

      const metaResponse = await fetch(
        `${BASE_URL}/messages/${ref.id}?${metaParams.toString()}`,
        { headers },
      );

      if (!metaResponse.ok) continue;

      const msg = (await metaResponse.json()) as ApiObject;
      const payload = (msg["payload"] ?? {}) as ApiObject;
      const msgHeaders = (payload["headers"] ?? []) as Array<{ name: string; value: string }>;

      summaries.push({
        id: String(msg["id"] ?? ""),
        threadId: String(msg["threadId"] ?? ""),
        subject: getHeader(msgHeaders, "Subject"),
        from: getHeader(msgHeaders, "From"),
        date: getHeader(msgHeaders, "Date"),
        snippet: String(msg["snippet"] ?? ""),
      });
    }

    return summaries;
  }
}
