import type { z } from "zod";
import type { CompanyDetails } from "../services/pdf.service.js";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService } from "../services/pdf.service.js";

// ── Generic result types returned by every strategy ─────────────────────────

/** A single row in the comparison table — strategy defines what fields go inside `breakdown`. */
export interface QuoteComparisonRow {
  itemName: string;
  /** Key-value pairs for each cost component (e.g. { pricePerM2: 12.5, aridos: 42 }) */
  breakdown: Record<string, number>;
  subtotal: number;
  vat: number;
  total: number;
}

export interface QuoteCalculationResult {
  rows: QuoteComparisonRow[];
  /** Free-form notes shown below the table (e.g. "Traviesa madera: 10 ml × 20,20 €/ml") */
  notes: string[];
  /** Section title above the table (e.g. "Suministro + Instalación (Todo incluido)") */
  sectionTitle: string;
  /** Strategy-specific data persisted as JSONB in the quotes table */
  quoteData: Record<string, unknown>;
  /** Representative totals for the quote record (typically the cheapest option) */
  representativeTotals: { subtotal: number; vat: number; total: number };
  /** Extra columns to persist on the quote row (e.g. surfaceType, areaM2) */
  extraColumns: Record<string, string | null>;
}

// ── PDF column definition for data-driven rendering ─────────────────────────

export interface PdfColumnDef {
  header: string;
  subheader?: string;
  /** Key in QuoteComparisonRow.breakdown, or "itemName"/"subtotal"/"vat"/"total" */
  field: string;
  width: number;
  bold?: boolean;
}

// ── The strategy contract ───────────────────────────────────────────────────

export interface QuoteStrategy {
  /** Unique identifier for this business type (e.g. "grass", "cleaning") */
  readonly businessType: string;

  /** Human-readable name (e.g. "Césped Artificial") */
  readonly displayName: string;

  /** Zod schema for the tool's inputSchema — strategy-specific fields */
  getInputSchema(): z.ZodObject<z.ZodRawShape>;

  /** Description shown to the LLM for the calculateBudget tool */
  getToolDescription(): string;

  /** System prompt for the QuoteAgent when this strategy is active */
  getAgentInstructions(lang: string): string;

  /** Description for the listCatalog tool */
  getListCatalogDescription(): string;

  /** Note returned by listCatalog to guide the LLM */
  getListCatalogNote(): string;

  /**
   * Core calculation: given validated params + catalog, produce comparison rows.
   * The tool handles context extraction, company resolution, and persistence.
   */
  calculate(params: {
    input: Record<string, unknown>;
    company: CompanyDetails;
    catalogId: string;
    catalogService: CatalogService;
  }): Promise<QuoteCalculationResult>;

  /**
   * Generate the PDF for this quote type.
   * Each strategy owns its PDF layout — can delegate to PdfService methods or render custom.
   */
  generatePdf(params: {
    quoteNumber: string;
    date: string;
    company: CompanyDetails;
    clientName: string;
    clientAddress: string;
    province: string;
    result: QuoteCalculationResult;
    pdfService: PdfService;
  }): Promise<string>;
}
