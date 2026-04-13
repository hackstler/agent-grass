import type { OAuthTokenProvider } from "../../google-common/oauth-token-provider.js";
import { driveConfig } from "../config/drive.config.js";
import { logger } from "../../../shared/logger.js";

const BASE_URL = "https://www.googleapis.com/drive/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiObject = Record<string, any>;

export interface DriveUploadResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
  folderPath: string;
}

export class DriveApiService {
  constructor(private readonly tokenProvider: OAuthTokenProvider) {}

  private async getAuthHeaders(userId: string): Promise<Record<string, string>> {
    const token = await this.tokenProvider.getAccessToken(userId, [...driveConfig.scopes]);
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Upload a file to Drive inside an organized folder structure:
   *   /Facturas/{year}-Q{quarter}/{filename}
   *
   * Creates folders if they don't exist (idempotent via name lookup).
   */
  async uploadReceipt(
    userId: string,
    fileData: Uint8Array,
    mimeType: string,
    filename: string,
    date: string, // YYYY-MM-DD — used for folder organization
  ): Promise<DriveUploadResult> {
    const headers = await this.getAuthHeaders(userId);

    // Determine folder path from date
    const d = new Date(date);
    const year = d.getFullYear();
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    const subFolderName = `${year}-Q${quarter}`;

    // Ensure folder structure exists
    const rootFolderId = await this.ensureFolder(headers, driveConfig.rootFolderName, "root");
    const subFolderId = await this.ensureFolder(headers, subFolderName, rootFolderId);

    // Upload file (multipart: metadata + content)
    const metadata = JSON.stringify({
      name: filename,
      parents: [subFolderId],
    });

    const boundary = "receipt_upload_boundary";
    const body = [
      `--${boundary}\r\n`,
      `Content-Type: application/json; charset=UTF-8\r\n\r\n`,
      `${metadata}\r\n`,
      `--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n`,
      `Content-Transfer-Encoding: base64\r\n\r\n`,
      `${Buffer.from(fileData).toString("base64")}\r\n`,
      `--${boundary}--`,
    ].join("");

    const res = await fetch(`${UPLOAD_URL}/files?uploadType=multipart&fields=id,name,webViewLink`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      logger.error({ status: res.status, body: err }, "Drive upload failed");
      throw new Error(`Drive upload failed: ${res.status}`);
    }

    const file = (await res.json()) as ApiObject;

    return {
      fileId: file["id"] as string,
      fileName: file["name"] as string,
      webViewLink: (file["webViewLink"] as string) ?? "",
      folderPath: `/${driveConfig.rootFolderName}/${subFolderName}`,
    };
  }

  /**
   * Find or create a folder by name inside a parent folder.
   * Idempotent: returns the existing folder ID if it already exists.
   */
  private async ensureFolder(
    headers: Record<string, string>,
    name: string,
    parentId: string,
  ): Promise<string> {
    // Search for existing folder
    const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const searchRes = await fetch(
      `${BASE_URL}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`,
      { headers: { ...headers, "Content-Type": "application/json" } },
    );

    if (searchRes.ok) {
      const data = (await searchRes.json()) as ApiObject;
      const files = data["files"] as ApiObject[] | undefined;
      if (files?.length) {
        return files[0]!["id"] as string;
      }
    }

    // Create folder
    const createRes = await fetch(`${BASE_URL}/files?fields=id`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text().catch(() => "");
      throw new Error(`Drive folder creation failed: ${createRes.status} ${err}`);
    }

    const folder = (await createRes.json()) as ApiObject;
    return folder["id"] as string;
  }
}
