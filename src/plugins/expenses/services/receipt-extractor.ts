import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { MediaAttachment } from "../../../agent/types.js";
import { ragConfig } from "../../rag/config/rag.config.js";
import { logger } from "../../../shared/logger.js";

/**
 * Strict schema for structured receipt extraction.
 * generateObject forces Gemini to return ONLY these fields — no prose, no hallucination.
 */
const ReceiptSchema = z.object({
  vendor: z.string().describe("Nombre del proveedor exactamente como aparece en el ticket/factura. Si no es legible, devuelve cadena vacía."),
  vendorCif: z.string().nullable().describe("CIF/NIF del proveedor si aparece, null si no."),
  amount: z.number().describe("Importe TOTAL a pagar (con IVA incluido). 0 si no es legible."),
  vatAmount: z.number().nullable().describe("Cuota de IVA en euros (NO el porcentaje). null si no aparece desglosado."),
  vatRate: z.number().nullable().describe("Porcentaje de IVA (21, 10, 4). null si no aparece."),
  date: z.string().describe("Fecha en formato YYYY-MM-DD. Cadena vacía si no es legible."),
  concept: z.string().describe("Descripción breve del tipo de gasto basándote en los productos/servicios visibles."),
  productsSummary: z.string().nullable().describe("Resumen de los productos/servicios principales del ticket."),
  paymentMethod: z.string().nullable().describe("Método de pago si aparece (efectivo, tarjeta, etc)."),
  confidence: z.enum(["high", "medium", "low"]).describe("Tu confianza general en la extracción: high si todo legible, medium si algunos campos borrosos, low si la imagen es muy mala."),
  unreadableFields: z.array(z.string()).describe("Lista de campos que no pudiste leer. Array vacío si todo legible."),
});

export type ExtractedReceipt = z.infer<typeof ReceiptSchema>;

const EXTRACTION_PROMPT = `Extrae los datos de este ticket o factura española.

REGLAS ABSOLUTAS:
- SOLO devuelve datos que puedas LEER CLARAMENTE en la imagen.
- Si un campo no es legible o no aparece, usa el valor nulo/vacío del esquema.
- NUNCA inventes, estimes ni adivines valores. Prefiere devolver null/vacío a inventar.
- El campo "amount" es el TOTAL A PAGAR (última línea grande del ticket, incluye IVA).
- El campo "vatAmount" es la CUOTA de IVA en euros, NO el porcentaje.
- Si hay múltiples tipos de IVA (A, B, C), suma todas las cuotas.
- La fecha debe ser exactamente como aparece, convertida a YYYY-MM-DD.`;

/**
 * Extract structured data from a receipt image using generateObject.
 * This is a dedicated extraction step (gather phase) — NOT a conversational call.
 *
 * Returns null if extraction fails entirely (no image, API error, etc).
 */
export async function extractReceiptData(attachment: MediaAttachment): Promise<ExtractedReceipt | null> {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    logger.error("Missing GOOGLE_API_KEY for receipt extraction");
    return null;
  }

  try {
    const google = createGoogleGenerativeAI({ apiKey });

    const result = await generateObject({
      model: google(ragConfig.llmModel),
      schema: ReceiptSchema,
      messages: [
        {
          role: "user",
          content: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { type: "image" as const, image: attachment.data, mimeType: attachment.mimeType } as any,
            { type: "text" as const, text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    return result.object;
  } catch (err) {
    logger.error({ err }, "Receipt extraction failed");
    return null;
  }
}

/**
 * Validate extracted data with programmatic rules (verify phase).
 * Returns a list of issues — empty means all good.
 */
export function validateExtraction(data: ExtractedReceipt): string[] {
  const issues: string[] = [];

  if (!data.vendor || data.vendor.trim().length < 2) {
    issues.push("proveedor no detectado");
  }
  if (data.amount <= 0) {
    issues.push("importe no detectado o inválido");
  }
  if (data.amount > 50000) {
    issues.push(`importe sospechosamente alto: ${data.amount}€`);
  }
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    issues.push("fecha no detectada o formato inválido");
  }
  if (data.date) {
    const parsed = new Date(data.date);
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneWeekAhead = new Date(now);
    oneWeekAhead.setDate(oneWeekAhead.getDate() + 7);

    if (parsed < oneYearAgo) issues.push(`fecha muy antigua: ${data.date}`);
    if (parsed > oneWeekAhead) issues.push(`fecha en el futuro: ${data.date}`);
  }
  if (data.vatAmount != null && data.amount > 0 && data.vatAmount > data.amount) {
    issues.push("IVA mayor que el importe total");
  }
  if (data.confidence === "low") {
    issues.push("confianza baja en la extracción — imagen poco legible");
  }

  return issues;
}

/**
 * Format extracted data into a structured text block for the conversational agent.
 * Includes validation warnings if any.
 */
export function formatExtractionForAgent(data: ExtractedReceipt, issues: string[]): string {
  const lines = [
    "== DATOS EXTRAÍDOS DEL TICKET (extracción automática) ==",
    `Proveedor: ${data.vendor || "[NO LEGIBLE]"}`,
    data.vendorCif ? `CIF: ${data.vendorCif}` : null,
    `Importe total: ${data.amount > 0 ? `${data.amount}€` : "[NO LEGIBLE]"}`,
    data.vatAmount != null ? `Cuota IVA: ${data.vatAmount}€${data.vatRate ? ` (${data.vatRate}%)` : ""}` : "IVA: no visible en el documento",
    `Fecha: ${data.date || "[NO LEGIBLE]"}`,
    `Concepto: ${data.concept || "[NO DETERMINADO]"}`,
    data.productsSummary ? `Productos: ${data.productsSummary}` : null,
    data.paymentMethod ? `Pago: ${data.paymentMethod}` : null,
    `Confianza: ${data.confidence}`,
  ].filter(Boolean).join("\n");

  const unreadable = data.unreadableFields.length > 0
    ? `\nCampos no legibles: ${data.unreadableFields.join(", ")}`
    : "";

  const warnings = issues.length > 0
    ? `\n⚠️ PROBLEMAS DETECTADOS: ${issues.join("; ")}\nPide al usuario que confirme o corrija estos datos.`
    : "";

  return `${lines}${unreadable}${warnings}\n\nPresenta estos datos al usuario y pide confirmación ANTES de guardar.`;
}
