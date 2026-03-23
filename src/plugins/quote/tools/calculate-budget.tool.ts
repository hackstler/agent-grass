import { tool } from "ai";
import { z } from "zod";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService, CompanyDetails } from "../services/pdf.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../../domain/ports/repositories/organization.repository.js";
import type { QuoteRepository } from "../../../domain/ports/repositories/quote.repository.js";
import type { QuoteStrategyRegistry } from "../strategies/index.js";
import type { QuoteFooterSettings } from "../services/pdf.service.js";
import { quoteConfig } from "../config/quote.config.js";
import { pdfStore } from "../services/pdf-store.js";
import { getAgentContextValue } from "../../../application/agent-context.js";
import { logger } from "../../../shared/logger.js";

export interface CalculateBudgetDeps {
  catalogService: CatalogService;
  pdfService: PdfService;
  attachmentStore: AttachmentStore;
  organizationRepo: OrganizationRepository;
  quoteRepo: QuoteRepository;
  strategyRegistry: QuoteStrategyRegistry;
}

/** Build QuoteFooterSettings from org.quoteSettings, falling back to quoteConfig defaults. */
function resolveQuoteFooter(
  org: { quoteSettings?: import("../../../domain/entities/index.js").QuoteSettings | null } | null,
): QuoteFooterSettings {
  const qs = org?.quoteSettings;
  return {
    paymentTerms: qs?.paymentTerms ?? quoteConfig.paymentTerms,
    quoteValidityDays: qs?.quoteValidityDays ?? quoteConfig.quoteValidityDays,
    companyRegistration: qs?.companyRegistration ?? quoteConfig.companyRegistration,
  };
}

/** Build CompanyDetails from org record, falling back to quoteConfig defaults. */
function resolveCompanyDetails(
  org: { name: string | null; address: string | null; phone: string | null; email: string | null; nif: string | null; logo: string | null; web: string | null; vatRate: string | null; currency: string } | null,
): CompanyDetails {
  return {
    name:     org?.name    ?? quoteConfig.companyName,
    address:  org?.address ?? quoteConfig.companyAddress,
    phone:    org?.phone   ?? quoteConfig.companyPhone,
    email:    org?.email   ?? quoteConfig.companyEmail,
    nif:      org?.nif     ?? quoteConfig.companyNif,
    logo:     org?.logo    ?? null,
    web:      org?.web     ?? "",
    vatRate:  org?.vatRate  ? Number(org.vatRate) : quoteConfig.vatRate,
    currency: org?.currency ?? quoteConfig.currency,
  };
}

export function createCalculateBudgetTool({ catalogService, pdfService, attachmentStore, organizationRepo, quoteRepo, strategyRegistry }: CalculateBudgetDeps) {
  // Use default strategy for schema and description (at tool creation time)
  const strategy = strategyRegistry.getDefault();

  return tool({
    description: strategy.getToolDescription(),

    inputSchema: strategy.getInputSchema(),

    execute: async ({ clientName, clientAddress, province, areaM2, surfaceType, perimeterLm, sacasAridos, applyVat }, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) {
        return {
          success: false, clientName, areaM2: 0, surfaceType: "",
          rows: [], pdfGenerated: false, filename: "",
          error: "Missing orgId in request context",
        };
      }

      // Fetch org data and catalog in parallel
      const [org, activeCatalog] = await Promise.all([
        organizationRepo.findByOrgId(orgId),
        catalogService.getActiveCatalog(orgId),
      ]);

      if (!activeCatalog) {
        return {
          success: false, clientName, areaM2, surfaceType,
          rows: [], pdfGenerated: false, filename: "",
          error: "No active catalog found for this organization",
        };
      }

      // Resolve strategy from catalog's businessType
      const activeStrategy = strategyRegistry.resolve(activeCatalog.businessType);
      const company = resolveCompanyDetails(org);
      const footer = resolveQuoteFooter(org);

      // Pack all input fields for the strategy
      const strategyInput: Record<string, unknown> = {
        clientName, clientAddress, province, areaM2, surfaceType, perimeterLm, sacasAridos, applyVat,
      };

      // Delegate calculation to the strategy
      let result;
      try {
        result = await activeStrategy.calculate({
          input: strategyInput,
          company,
          catalogId: activeCatalog.id,
          catalogService,
          catalogSettings: activeCatalog.settings,
        });
      } catch (err) {
        return {
          success: false, clientName, areaM2, surfaceType,
          rows: [], pdfGenerated: false, filename: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Generate quote number and filename
      const now = new Date();
      const quoteNumber = `PRES-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Date.now().toString().slice(-4)}`;
      const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
      const filename = `${quoteNumber}.pdf`;

      // Delegate PDF generation to the strategy
      const pdfBase64 = await activeStrategy.generatePdf({
        quoteNumber,
        date: dateStr,
        company,
        clientName,
        clientAddress,
        province: province ?? "",
        result,
        pdfService,
        footer,
      });

      // Store PDF for controller retrieval (WhatsApp delivery)
      const pdfRequestId = getAgentContextValue({ experimental_context }, "pdfRequestId");
      if (pdfRequestId && pdfBase64) {
        pdfStore.set(pdfRequestId, { pdfBase64, filename });
      }

      // Store in AttachmentStore for cross-plugin retrieval (e.g. Gmail)
      if (pdfBase64) {
        attachmentStore.store(filename, { base64: pdfBase64, mimetype: "application/pdf", filename });
      }

      // Persist quote to DB
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (userId && orgId) {
        try {
          await quoteRepo.create({
            orgId,
            userId,
            quoteNumber,
            clientName,
            clientAddress,
            lineItems: [], // comparison quotes don't use line items
            subtotal: String(result.representativeTotals.subtotal),
            vatAmount: String(result.representativeTotals.vat),
            total: String(result.representativeTotals.total),
            pdfBase64: pdfBase64 ?? null,
            filename,
            quoteData: result.quoteData as Record<string, unknown>,
            ...result.extraColumns,
          });
        } catch (err) {
          logger.error({ err }, "Failed to persist quote");
        }
      }

      // Build response (same shape as before for backward compat)
      return {
        success: true,
        clientName,
        areaM2,
        surfaceType,
        rows: result.rows.map((r) => ({
          grassName: r.itemName,
          pricePerM2: r.breakdown["pricePerM2"] ?? 0,
          totalConIva: r.total,
        })),
        pdfGenerated: !!pdfBase64,
        filename,
      };
    },
  });
}
