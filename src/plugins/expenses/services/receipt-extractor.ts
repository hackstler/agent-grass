import { z } from "zod";
import type { MediaAttachment } from "../../../agent/types.js";
import { logger } from "../../../shared/logger.js";

/**
 * Strict schema for structured receipt extraction.
 * Used for validation AFTER JSON extraction.
 */
const ReceiptSchema = z.object({
  vendor: z.string().default(""),
  vendorCif: z.string().nullish().default(null),
  amount: z.number().default(0),
  vatAmount: z.number().nullish().default(null),
  vatRate: z.number().nullish().default(null),
  date: z.string().default(""),
  concept: z.string().default(""),
  productsSummary: z.string().nullish().default(null),
  paymentMethod: z.string().nullish().default(null),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  unreadableFields: z.array(z.string()).default([]),
});

export type ExtractedReceipt = z.infer<typeof ReceiptSchema>;

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

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
  "vatAmount": 0.00,
  "vatRate": 21,
  "date": "YYYY-MM-DD o cadena vacía",
  "concept": "descripción breve",
  "productsSummary": "resumen de productos o null",
  "paymentMethod": "efectivo/tarjeta/null",
  "confidence": "high|medium|low",
  "unreadableFields": []
}`;

/**
 * Extract structured data from a receipt image.
 *
 * Calls the Gemini REST API DIRECTLY — no AI SDK, no provider abstraction.
 * This eliminates all possible SDK conversion/normalization issues.
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

  // Use the configured model or fall back to gemini-2.0-flash (widely available, fast, good at OCR)
  const model = process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash";
  const base64Image = Buffer.from(attachment.data).toString("base64");

  logger.info(
    { mimeType: attachment.mimeType, bytes: attachment.data.length, base64Length: base64Image.length, model },
    "Starting direct Gemini API receipt extraction",
  );

  try {
    const url = `${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: attachment.mimeType,
              data: base64Image,
            },
          },
          {
            text: EXTRACTION_PROMPT,
          },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      logger.error({ status: res.status, body: errText.slice(0, 500), model }, "Gemini API error in receipt extraction");
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await res.json() as any;
    const rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!rawText) {
      logger.warn({ response: JSON.stringify(response).slice(0, 500) }, "Gemini returned no text in receipt extraction");
      return null;
    }

    logger.info({ rawText: rawText.slice(0, 300) }, "Raw Gemini extraction response");

    // Strip markdown code fences if present
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

    const result = validated.data;

    // Normalize vatRate: Gemini sometimes returns 0.10 instead of 10
    if (result.vatRate != null && result.vatRate > 0 && result.vatRate < 1) {
      result.vatRate = Math.round(result.vatRate * 100);
    }

    logger.info(
      { vendor: result.vendor, amount: result.amount, confidence: result.confidence },
      "Receipt extraction succeeded",
    );

    return result;
  } catch (err) {
    logger.error({ err }, "Receipt extraction failed (exception)");
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
export function formatExtractionForAgent(data: ExtractedReceipt, issues: string[], receiptFilename?: string): string {
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

  const receiptRef = receiptFilename
    ? `\nComprobante guardado: ${receiptFilename}`
    : "";

  const warnings = issues.length > 0
    ? `\n⚠️ PROBLEMAS DETECTADOS: ${issues.join("; ")}\nPide al usuario que confirme o corrija estos datos.`
    : "";

  return `${lines}${unreadable}${receiptRef}${warnings}`;
}
