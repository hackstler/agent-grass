import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { MediaAttachment } from "../../../agent/types.js";
import { logger } from "../../../shared/logger.js";

/**
 * Strict schema for structured receipt extraction.
 * Used for validation AFTER text-based JSON extraction.
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

/** Dedicated model for receipt extraction — Flash is fast, cheap, and good at OCR. */
const EXTRACTION_MODEL = "gemini-2.5-flash";

const EXTRACTION_PROMPT = `Analiza esta imagen de un ticket o factura española y extrae los datos en formato JSON.

REGLAS ABSOLUTAS:
- SOLO devuelve datos que puedas LEER CLARAMENTE en la imagen.
- Si un campo no es legible o no aparece, usa null o cadena vacía según corresponda.
- NUNCA inventes, estimes ni adivines valores. Prefiere devolver null/vacío a inventar.
- El campo "amount" es el TOTAL A PAGAR (última línea grande del ticket, incluye IVA).
- El campo "vatAmount" es la CUOTA de IVA en euros, NO el porcentaje.
- Si hay múltiples tipos de IVA, suma todas las cuotas.
- La fecha debe ser exactamente como aparece, convertida a YYYY-MM-DD.

Devuelve EXCLUSIVAMENTE un objeto JSON con esta estructura (sin markdown, sin texto adicional):
{
  "vendor": "nombre del proveedor o cadena vacía",
  "vendorCif": "CIF/NIF o null",
  "amount": 0.00,
  "vatAmount": 0.00 o null,
  "vatRate": 21 o null,
  "date": "YYYY-MM-DD o cadena vacía",
  "concept": "descripción breve",
  "productsSummary": "resumen de productos o null",
  "paymentMethod": "efectivo/tarjeta/null",
  "confidence": "high|medium|low",
  "unreadableFields": []
}`;

/**
 * Extract structured data from a receipt image using generateText + JSON parsing.
 *
 * Uses generateText (NOT generateObject) because Gemini's structured output mode
 * (responseSchema) is unreliable with multimodal input — it often fails silently
 * or returns empty data when images are present.
 *
 * Returns null if extraction fails entirely.
 */
export async function extractReceiptData(attachment: MediaAttachment): Promise<ExtractedReceipt | null> {
  const apiKey = process.env["GOOGLE_API_KEY"] ?? process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) {
    logger.error("Missing GOOGLE_API_KEY for receipt extraction");
    return null;
  }

  // Validate image data
  if (!attachment.data || attachment.data.length < 1000) {
    logger.warn({ bytes: attachment.data?.length ?? 0 }, "Receipt image too small — likely corrupted");
    return null;
  }

  logger.info(
    { mimeType: attachment.mimeType, bytes: attachment.data.length, model: EXTRACTION_MODEL },
    "Starting receipt extraction",
  );

  try {
    const google = createGoogleGenerativeAI({ apiKey });

    const result = await generateText({
      model: google(EXTRACTION_MODEL),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image" as const,
              image: attachment.data,
              mimeType: attachment.mimeType,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            { type: "text" as const, text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const rawText = result.text?.trim();
    if (!rawText) {
      logger.warn("Receipt extraction returned empty text");
      return null;
    }

    logger.debug({ rawText: rawText.slice(0, 500) }, "Raw extraction response");

    // Strip markdown code fences if present (```json ... ```)
    const jsonText = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      logger.warn({ rawText: rawText.slice(0, 300), err: parseErr }, "Failed to parse extraction JSON");
      return null;
    }

    const validated = ReceiptSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn({ errors: validated.error.issues, parsed }, "Extraction JSON failed schema validation");
      return null;
    }

    logger.info(
      { vendor: validated.data.vendor, amount: validated.data.amount, confidence: validated.data.confidence },
      "Receipt extraction succeeded",
    );

    return validated.data;
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
