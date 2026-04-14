import { tool } from "ai";
import { z } from "zod";
import { getAgentContextValue } from "../../../application/agent-context.js";
import type { DriveApiService } from "../../drive/services/drive-api.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import { takePendingMedia } from "../../../agent/pending-media.js";
import { logger } from "../../../shared/logger.js";

export function createUploadReceiptTool(driveService: DriveApiService, attachmentStore?: AttachmentStore) {
  return tool({
    description:
      "Sube una imagen de factura o ticket a Google Drive del usuario, " +
      "organizado automáticamente en /Facturas/{año}-Q{trimestre}/. " +
      "Usar después de registrar un gasto con recordExpense para archivar el comprobante. " +
      "IMPORTANTE: usa el valor de 'Comprobante guardado' de los datos extraídos como receiptFilename.",
    inputSchema: z.object({
      filename: z.string().describe("Nombre del archivo para Drive (ej: 'carrefour_2026-04-11.jpg')"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha del gasto en YYYY-MM-DD (para organizar en carpeta)"),
      receiptFilename: z.string().optional().describe(
        "Nombre exacto del comprobante guardado (aparece en los datos extraídos como 'Comprobante guardado: ...'). " +
        "Si está disponible, se usa para recuperar la imagen del almacén.",
      ),
    }),
    execute: async ({ filename, date, receiptFilename }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error("Contexto de usuario no disponible");

      // 1. Try attachment store (persistent — survives across turns)
      let imageData: Uint8Array | undefined;
      let mimeType = "image/jpeg";

      if (receiptFilename && attachmentStore) {
        const stored = await attachmentStore.retrieve(userId, receiptFilename);
        if (stored) {
          imageData = new Uint8Array(Buffer.from(stored.base64, "base64"));
          mimeType = stored.mimetype;
          logger.info({ receiptFilename, userId, bytes: imageData.length }, "Receipt image retrieved from attachment store for Drive upload");
        }
      }

      // 2. Fallback: pending media (ephemeral — same request only)
      if (!imageData) {
        const conversationId = getAgentContextValue({ experimental_context }, "conversationId");
        const media = conversationId ? takePendingMedia(conversationId) : undefined;
        if (media?.length) {
          imageData = media[0]!.data instanceof Uint8Array ? media[0]!.data : new Uint8Array(media[0]!.data);
          mimeType = media[0]!.mimeType;
          logger.info({ conversationId, bytes: imageData.length }, "Receipt image from pending media for Drive upload");
        }
      }

      if (!imageData) {
        return {
          success: false,
          message: "No hay imagen disponible para subir a Drive. El usuario debe enviar la imagen de nuevo.",
        };
      }

      const result = await driveService.uploadReceipt(userId, imageData, mimeType, filename, date);

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
