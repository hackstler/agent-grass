import { z } from "zod";
import type {
  QuoteStrategy,
  QuoteCalculationResult,
  QuoteComparisonRow,
} from "./quote-strategy.interface.js";
import type { CompanyDetails } from "../services/pdf.service.js";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService, ComparisonPdfData, ComparisonRow } from "../services/pdf.service.js";
import { quoteConfig } from "../config/quote.config.js";
import type { GrassQuoteDataJson, GrassComparisonRowJson } from "../../../infrastructure/db/schema.js";

// ── Input schema (identical to current calculateBudget inputSchema) ─────────

const grassInputSchema = z.object({
  clientName: z.string().min(3).refine(
    (v) => !["cliente", "desconocido", "unknown", "n/a"].includes(v.toLowerCase().trim()),
    { message: "Client name must be a real name, not a placeholder. Ask the seller for the actual client name." },
  ).describe("Full name of the client (real name, not generic)"),
  clientAddress: z.string().min(10).refine(
    (v) => !["desconocida", "unknown", "n/a", "sin dirección", "sin direccion"].includes(v.toLowerCase().trim()),
    { message: "Client address must be a real address, not a placeholder. Ask the seller for the actual address." },
  ).describe("Full address of the client (real address, at least street and number)"),
  province: z.string().optional().describe("Province (e.g. Madrid, Toledo)"),
  areaM2: z.number().positive().describe("Surface area in square meters"),
  surfaceType: z.enum(["SOLADO", "TIERRA"]).describe("SOLADO = concrete/tiles, TIERRA = natural ground"),
  perimeterLm: z.number().nonnegative().default(0).describe("Perimeter in linear meters (for wooden borders). 0 if none needed"),
  sacasAridos: z.number().nonnegative().default(0).describe("Number of zahorra bags for ground preparation. Only for TIERRA. 0 if none needed"),
  applyVat: z.boolean().default(true).describe("Whether to include 21% VAT"),
});

// ── GrassQuoteStrategy ──────────────────────────────────────────────────────

export class GrassQuoteStrategy implements QuoteStrategy {
  readonly businessType = "grass";
  readonly displayName = "Césped Artificial";

  getInputSchema() {
    return grassInputSchema;
  }

  getToolDescription(): string {
    return `Calculate a comparison quote for artificial grass installation and generate a PDF.
The quote compares ALL 8 grass types side by side for the given surface area and type.
Required: client name, address, area in m², surface type (SOLADO or TIERRA), perimeter in linear meters.
Returns a table with pricing for each grass type and generates a comparison PDF.`;
  }

  getAgentInstructions(lang: string): string {
    return `Eres un especialista en presupuestos de césped artificial.

== REGLA ABSOLUTA ==
NUNCA inventes datos del cliente. Si no tienes el nombre real, la dirección real o cualquier dato obligatorio, PREGUNTA al vendedor. No uses valores genéricos como "cliente", "desconocido", "sin dirección", "N/A".

== CONTEXTO ==
Hablas con un VENDEDOR de césped artificial, NO con el cliente final. El vendedor te da los datos del cliente y tú generas el presupuesto comparativo.

== DATOS NECESARIOS ==
Obligatorios:
1. Nombre completo del cliente (nombre real, no genérico)
2. Dirección completa del cliente (dirección real, mínimo calle y número)
3. Metros cuadrados (m²) de la superficie
4. Tipo de base: SOLADO (hormigón/baldosa) o TIERRA (tierra natural)

Opcionales:
5. Provincia (por defecto no se incluye)
6. Perímetro en metros lineales para traviesas de madera (solo si el vendedor las menciona, default 0)
7. Sacas de áridos/zahorra para preparación de la base (solo si surfaceType=TIERRA y el vendedor lo menciona, default 0)

== FLUJO ==
- Si falta nombre o dirección del cliente, PREGUNTA. No procedas sin ellos.
- Si el vendedor no dice el tipo de base, preguntar: "¿La superficie actual es de hormigón/baldosa (SOLADO) o tierra natural (TIERRA)?"
- Si surfaceType=TIERRA, puedes preguntar: "¿Necesita sacas de zahorra para preparar la base?"
- Las traviesas y los áridos son OPCIONALES. Solo incluirlos si el vendedor los menciona explícitamente.
- Una vez tengas todos los datos obligatorios, llamar directamente a calculateBudget.
- NO llamar a listCatalog — el presupuesto muestra TODOS los tipos de césped automáticamente.

== RESULTADO ==
- Se genera una tabla comparativa con los 8 tipos de césped + Áridos + Traviesas + IVA.
- El PDF se genera automáticamente.
- Presenta un resumen al vendedor con los rangos de precio (del más económico al premium).

Responde SIEMPRE en ${lang}.`;
  }

  getListCatalogDescription(): string {
    return `List the available grass types in the organization's catalog.
Returns grass type names and descriptions. Pricing varies by surface type and m² — use calculateBudget for actual prices.`;
  }

  getListCatalogNote(): string {
    return "El pricing varía según tipo de superficie (SOLADO/TIERRA) y m². Usa calculateBudget para precios exactos.";
  }

  // ── Calculation (exact same logic as current calculate-budget.tool.ts) ─────

  async calculate(params: {
    input: Record<string, unknown>;
    company: CompanyDetails;
    catalogId: string;
    catalogService: CatalogService;
  }): Promise<QuoteCalculationResult> {
    const { input, company, catalogId, catalogService } = params;

    const areaM2 = input["areaM2"] as number;
    const surfaceType = input["surfaceType"] as "SOLADO" | "TIERRA";
    const perimeterLm = (input["perimeterLm"] as number) ?? 0;
    const sacasAridos = (input["sacasAridos"] as number) ?? 0;
    const applyVat = (input["applyVat"] as boolean) ?? true;

    // Get price/m² for all 8 grass types
    const grassPrices = await catalogService.getAllGrassPrices(catalogId, surfaceType, areaM2);
    if (grassPrices.length === 0) {
      throw new Error("No grass pricing data found. Please seed the catalog first.");
    }

    // Calculate traviesas and áridos costs (identical formulas)
    const traviesasCost = Math.round(perimeterLm * quoteConfig.traviesasPricePerLm * 100) / 100;
    const aridosCost = Math.round(sacasAridos * quoteConfig.aridosPricePerSaca * 100) / 100;

    // Build comparison rows (identical to current logic)
    const comparisonRows: GrassComparisonRowJson[] = grassPrices.map((gp) => {
      const totalGrassInstalled = Math.round(gp.pricePerM2 * areaM2 * 100) / 100;
      const baseImponible = Math.round((totalGrassInstalled + aridosCost + traviesasCost) * 100) / 100;
      const iva = applyVat ? Math.round(baseImponible * company.vatRate * 100) / 100 : 0;
      const totalConIva = Math.round((baseImponible + iva) * 100) / 100;
      return {
        grassName: gp.grassName,
        pricePerM2: gp.pricePerM2,
        totalGrassInstalled,
        aridosTotal: aridosCost,
        traviesasTotal: traviesasCost,
        baseImponible,
        iva,
        totalConIva,
      };
    });

    // Map to generic QuoteComparisonRow
    const rows: QuoteComparisonRow[] = comparisonRows.map((r) => ({
      itemName: r.grassName,
      breakdown: {
        pricePerM2: r.pricePerM2,
        totalGrassInstalled: r.totalGrassInstalled,
        aridosTotal: r.aridosTotal,
        traviesasTotal: r.traviesasTotal,
        baseImponible: r.baseImponible,
      },
      subtotal: r.baseImponible,
      vat: r.iva,
      total: r.totalConIva,
    }));

    // Notes
    const notes: string[] = [];
    if (perimeterLm > 0) {
      notes.push(`Traviesa madera tratada: ${perimeterLm} ml × ${quoteConfig.traviesasPricePerLm} €/ml`);
    }
    if (sacasAridos > 0) {
      notes.push(`Zahorra: ${sacasAridos} sacas × ${quoteConfig.aridosPricePerSaca} €/saca`);
    }

    // Build JSONB data for DB persistence (identical structure)
    const quoteData: Record<string, unknown> = {
      areaM2,
      surfaceType,
      perimeterLm,
      sacasAridos,
      rows: comparisonRows,
      traviesasNote: `Traviesa madera tratada: ${perimeterLm} ml × ${quoteConfig.traviesasPricePerLm} €/ml`,
      ...(sacasAridos > 0 && { aridosNote: `Zahorra: ${sacasAridos} sacas × ${quoteConfig.aridosPricePerSaca} €/saca` }),
    };

    // Representative totals (cheapest row, for backward compat)
    const cheapest = comparisonRows[0]!;

    return {
      rows,
      notes,
      sectionTitle: "Suministro + Instalación (Todo incluido)",
      quoteData,
      representativeTotals: {
        subtotal: cheapest.baseImponible,
        vat: cheapest.iva,
        total: cheapest.totalConIva,
      },
      extraColumns: {
        surfaceType,
        areaM2: String(areaM2),
        perimeterLm: String(perimeterLm),
        province: (input["province"] as string) ?? null,
      },
    };
  }

  // ── PDF generation (delegates to existing PdfService.generateComparisonPdf) ─

  async generatePdf(params: {
    quoteNumber: string;
    date: string;
    company: CompanyDetails;
    clientName: string;
    clientAddress: string;
    province: string;
    result: QuoteCalculationResult;
    pdfService: PdfService;
  }): Promise<string> {
    const { quoteNumber, date, company, clientName, clientAddress, province, result, pdfService } = params;

    // Reconstruct the exact ComparisonPdfData that generateComparisonPdf expects
    const quoteData = result.quoteData as unknown as GrassQuoteDataJson;
    const comparisonRows: ComparisonRow[] = quoteData.rows.map((r) => ({
      grassName: r.grassName,
      pricePerM2: r.pricePerM2,
      totalGrassInstalled: r.totalGrassInstalled,
      aridosTotal: r.aridosTotal,
      traviesasTotal: r.traviesasTotal,
      baseImponible: r.baseImponible,
      iva: r.iva,
      totalConIva: r.totalConIva,
    }));

    const pdfData: ComparisonPdfData = {
      quoteNumber,
      date,
      company,
      clientName,
      clientAddress,
      province,
      areaM2: quoteData.areaM2,
      surfaceType: quoteData.surfaceType,
      perimeterLm: quoteData.perimeterLm,
      sacasAridos: quoteData.sacasAridos,
      rows: comparisonRows,
    };

    // Delegate to the EXACT same method — zero PDF changes
    return pdfService.generateComparisonPdf(pdfData);
  }
}
