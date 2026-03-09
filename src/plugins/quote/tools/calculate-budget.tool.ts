import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService, CompanyDetails } from "../services/pdf.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../../domain/ports/repositories/organization.repository.js";
import type { QuoteRepository } from "../../../domain/ports/repositories/quote.repository.js";
import { quoteConfig } from "../config/quote.config.js";
import { pdfStore } from "../services/pdf-store.js";
import type { GrassQuoteDataJson, GrassComparisonRowJson } from "../../../infrastructure/db/schema.js";

export interface CalculateBudgetDeps {
  catalogService: CatalogService;
  pdfService: PdfService;
  attachmentStore: AttachmentStore;
  organizationRepo: OrganizationRepository;
  quoteRepo: QuoteRepository;
}

/** Build CompanyDetails from org record, falling back to quoteConfig defaults. */
function resolveCompanyDetails(
  org: { name: string | null; address: string | null; phone: string | null; email: string | null; nif: string | null; logo: string | null; vatRate: string | null; currency: string } | null,
): CompanyDetails {
  return {
    name:     org?.name    ?? quoteConfig.companyName,
    address:  org?.address ?? quoteConfig.companyAddress,
    phone:    org?.phone   ?? quoteConfig.companyPhone,
    email:    org?.email   ?? quoteConfig.companyEmail,
    nif:      org?.nif     ?? quoteConfig.companyNif,
    logo:     org?.logo    ?? null,
    vatRate:  org?.vatRate  ? Number(org.vatRate) : quoteConfig.vatRate,
    currency: org?.currency ?? quoteConfig.currency,
    web:      quoteConfig.companyWeb,
  };
}

export function createCalculateBudgetTool({ catalogService, pdfService, attachmentStore, organizationRepo, quoteRepo }: CalculateBudgetDeps) {
  return createTool({
    id: "calculateBudget",
    description: `Calculate a comparison quote for artificial grass installation and generate a PDF.
The quote compares ALL 8 grass types side by side for the given surface area and type.
Required: client name, address, area in m², surface type (SOLADO or TIERRA), perimeter in linear meters.
Returns a table with pricing for each grass type and generates a comparison PDF.`,

    inputSchema: z.object({
      clientName: z.string().describe("Full name of the client"),
      clientAddress: z.string().describe("Address of the client"),
      province: z.string().optional().describe("Province (e.g. Madrid, Toledo)"),
      areaM2: z.number().positive().describe("Surface area in square meters"),
      surfaceType: z.enum(["SOLADO", "TIERRA"]).describe("SOLADO = concrete/tiles, TIERRA = natural ground"),
      perimeterLm: z.number().nonnegative().describe("Perimeter in linear meters (for wooden borders). 0 if none needed"),
      applyVat: z.boolean().default(true).describe("Whether to include 21% VAT"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      clientName: z.string(),
      areaM2: z.number(),
      surfaceType: z.string(),
      rows: z.array(z.object({
        grassName: z.string(),
        pricePerM2: z.number(),
        totalConIva: z.number(),
      })),
      pdfGenerated: z.boolean(),
      filename: z.string(),
      error: z.string().optional(),
    }),

    execute: async ({ clientName, clientAddress, province, areaM2, surfaceType, perimeterLm, applyVat }, context) => {
      const orgId = context?.requestContext?.get("orgId") as string | undefined;
      if (!orgId) {
        return {
          success: false, clientName, areaM2: 0, surfaceType: "",
          rows: [], pdfGenerated: false, filename: "",
          error: "Missing orgId in request context",
        };
      }

      // Fetch org data and catalog in parallel
      const [org, catalogId] = await Promise.all([
        organizationRepo.findByOrgId(orgId),
        catalogService.getActiveCatalogId(orgId),
      ]);

      if (!catalogId) {
        return {
          success: false, clientName, areaM2, surfaceType,
          rows: [], pdfGenerated: false, filename: "",
          error: "No active catalog found for this organization",
        };
      }

      const company = resolveCompanyDetails(org);

      // Get price/m² for all 8 grass types
      const grassPrices = await catalogService.getAllGrassPrices(catalogId, surfaceType, areaM2);
      if (grassPrices.length === 0) {
        return {
          success: false, clientName, areaM2, surfaceType,
          rows: [], pdfGenerated: false, filename: "",
          error: "No grass pricing data found. Please seed the catalog first.",
        };
      }

      // Calculate traviesas cost
      const traviesasCost = Math.round(perimeterLm * quoteConfig.traviesasPricePerLm * 100) / 100;

      // Build comparison rows
      const comparisonRows: GrassComparisonRowJson[] = grassPrices.map((gp) => {
        const totalGrassInstalled = Math.round(gp.pricePerM2 * areaM2 * 100) / 100;
        const baseImponible = Math.round((totalGrassInstalled + traviesasCost) * 100) / 100;
        const iva = applyVat ? Math.round(baseImponible * company.vatRate * 100) / 100 : 0;
        const totalConIva = Math.round((baseImponible + iva) * 100) / 100;
        return {
          grassName: gp.grassName,
          pricePerM2: gp.pricePerM2,
          totalGrassInstalled,
          traviesasTotal: traviesasCost,
          baseImponible,
          iva,
          totalConIva,
        };
      });

      // Generate quote number and filename
      const now = new Date();
      const quoteNumber = `PRES-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Date.now().toString().slice(-4)}`;
      const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
      const filename = `${quoteNumber}.pdf`;

      // Generate comparison PDF
      const pdfBase64 = await pdfService.generateComparisonPdf({
        quoteNumber,
        date: dateStr,
        company,
        clientName,
        clientAddress,
        province: province ?? "",
        areaM2,
        surfaceType,
        perimeterLm,
        rows: comparisonRows,
      });

      // Store PDF for controller retrieval (WhatsApp delivery)
      const pdfRequestId = context?.requestContext?.get("pdfRequestId") as string | undefined;
      if (pdfRequestId && pdfBase64) {
        pdfStore.set(pdfRequestId, { pdfBase64, filename });
      }

      // Store in AttachmentStore for cross-plugin retrieval (e.g. Gmail)
      if (pdfBase64) {
        attachmentStore.store(filename, { base64: pdfBase64, mimetype: "application/pdf", filename });
      }

      // Build JSONB data for DB persistence
      const quoteData: GrassQuoteDataJson = {
        areaM2,
        surfaceType,
        perimeterLm,
        rows: comparisonRows,
        traviesasNote: `Traviesa madera tratada: ${perimeterLm} ml × ${quoteConfig.traviesasPricePerLm} €/ml`,
      };

      // Use the cheapest row's total as the "representative" quote total for backward compat
      const cheapest = comparisonRows[0]!;
      const subtotal = String(cheapest.baseImponible);
      const vatAmount = String(cheapest.iva);
      const total = String(cheapest.totalConIva);

      // Persist quote to DB
      const userId = context?.requestContext?.get("userId") as string | undefined;
      if (userId && orgId) {
        try {
          await quoteRepo.create({
            orgId,
            userId,
            quoteNumber,
            clientName,
            clientAddress,
            lineItems: [], // comparison quotes don't use line items
            subtotal,
            vatAmount,
            total,
            pdfBase64: pdfBase64 ?? null,
            filename,
            quoteData,
            surfaceType,
            areaM2: String(areaM2),
            perimeterLm: String(perimeterLm),
            province: province ?? null,
          });
        } catch (err) {
          console.error("[quote] failed to persist quote:", err instanceof Error ? err.message : err);
        }
      }

      return {
        success: true,
        clientName,
        areaM2,
        surfaceType,
        rows: comparisonRows.map((r) => ({
          grassName: r.grassName,
          pricePerM2: r.pricePerM2,
          totalConIva: r.totalConIva,
        })),
        pdfGenerated: !!pdfBase64,
        filename,
      };
    },
  });
}
