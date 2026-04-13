import { tool } from "ai";
import { z } from "zod";
import { getAgentContextValue } from "../../../application/agent-context.js";
import type { DriveApiService } from "../../drive/services/drive-api.service.js";
import { takePendingMedia } from "../../../agent/pending-media.js";

export function createUploadReceiptTool(driveService: DriveApiService) {
  return tool({
    description:
      "Sube una imagen de factura o ticket a Google Drive del usuario, " +
      "organizado automáticamente en /Facturas/{año}-Q{trimestre}/. " +
      "Usar después de registrar un gasto con recordExpense para archivar el comprobante.",
    inputSchema: z.object({
      filename: z.string().describe("Nombre del archivo (ej: 'carrefour_2026-04-11.jpg')"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha del gasto en YYYY-MM-DD (para organizar en carpeta)"),
    }),
    execute: async ({ filename, date }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error("Contexto de usuario no disponible");

      const conversationId = getAgentContextValue({ experimental_context }, "conversationId");
      const media = conversationId ? takePendingMedia(conversationId) : undefined;

      if (!media?.length) {
        return {
          success: false,
          message: "No hay imagen disponible para subir a Drive. El usuario debe enviar la imagen de nuevo.",
        };
      }

      const attachment = media[0]!;
      const result = await driveService.uploadReceipt(
        userId,
        attachment.data,
        attachment.mimeType,
        filename,
        date,
      );

      return {
        success: true,
        fileId: result.fileId,
        fileName: result.fileName,
        webViewLink: result.webViewLink,
        folderPath: result.folderPath,
        message: `Archivo subido a Drive: ${result.folderPath}/${result.fileName}`,
      };
    },
  });
}
