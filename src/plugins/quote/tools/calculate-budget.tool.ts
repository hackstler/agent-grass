import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService, QuoteLineItem, CompanyDetails } from "../services/pdf.service.js";
import type { AttachmentStore } from "../../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../../domain/ports/repositories/organization.repository.js";
import { quoteConfig } from "../config/quote.config.js";
import { pdfStore } from "../services/pdf-store.js";

export interface CalculateBudgetDeps {
  catalogService: CatalogService;
  pdfService: PdfService;
  attachmentStore: AttachmentStore;
  organizationRepo: OrganizationRepository;
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
  };
}

export function createCalculateBudgetTool({ catalogService, pdfService, attachmentStore, organizationRepo }: CalculateBudgetDeps) {
  return createTool({
    id: "calculateBudget",
    description: `Calculate a price quote for artificial grass installation and generate a PDF.
Use this tool when the user wants to create a budget/quote for a client.
Required information: client name, client address, and list of items with quantities.
The tool looks up current prices from the product catalog in the database.
Returns a formatted summary and a PDF attachment.`,

    inputSchema: z.object({
      clientName: z.string().describe("Full name of the client"),
      clientAddress: z.string().describe("Address of the client"),
      items: z.array(
        z.object({
          nameOrCode: z.string().describe("Product name (partial match) or CODART number"),
          quantity: z.number().positive().describe("Quantity in the item's unit (m² or km)"),
        })
      ).min(1).describe("List of items with product name/code and quantity"),
      applyVat: z.boolean().default(true).describe("Whether to include VAT"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      clientName: z.string(),
      lineItems: z.array(z.object({
        description: z.string(),
        quantity: z.number(),
        unit: z.string(),
        unitPrice: z.number(),
        lineTotal: z.number(),
      })),
      subtotal: z.number(),
      vatAmount: z.number(),
      total: z.number(),
      pdfBase64: z.string(),
      filename: z.string(),
      notFound: z.array(z.string()),
    }),

    execute: async ({ clientName, clientAddress, items, applyVat }, context) => {
      const orgId = context?.requestContext?.get("orgId") as string | undefined;
      if (!orgId) {
        return {
          success: false,
          clientName,
          lineItems: [],
          subtotal: 0,
          vatAmount: 0,
          total: 0,
          pdfBase64: "",
          filename: "",
          notFound: ["Missing orgId in request context"],
        };
      }

      // Fetch org data and catalog in parallel
      const [org, catalogId] = await Promise.all([
        organizationRepo.findByOrgId(orgId),
        catalogService.getActiveCatalogId(orgId),
      ]);

      if (!catalogId) {
        return {
          success: false,
          clientName,
          lineItems: [],
          subtotal: 0,
          vatAmount: 0,
          total: 0,
          pdfBase64: "",
          filename: "",
          notFound: ["No active catalog found for this organization"],
        };
      }

      const company = resolveCompanyDetails(org);

      const resolvedItems: QuoteLineItem[] = [];
      const notFound: string[] = [];

      for (const item of items) {
        const catalogItem = await catalogService.findItem(catalogId, item.nameOrCode);
        if (!catalogItem) {
          notFound.push(item.nameOrCode);
          continue;
        }
        resolvedItems.push({
          description: catalogItem.name,
          quantity: item.quantity,
          unit: catalogItem.unit,
          unitPrice: catalogItem.pricePerUnit,
          lineTotal: Math.round(catalogItem.pricePerUnit * item.quantity * 100) / 100,
        });
      }

      const subtotal = Math.round(resolvedItems.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100;
      const vatAmount = applyVat ? Math.round(subtotal * company.vatRate * 100) / 100 : 0;
      const total = Math.round((subtotal + vatAmount) * 100) / 100;

      const now = new Date();
      const quoteNumber = `PRES-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Date.now().toString().slice(-4)}`;
      const dateStr = now.toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
      const filename = `${quoteNumber}.pdf`;

      const pdfBase64 = await pdfService.generateQuotePdf({
        quoteNumber,
        date: dateStr,
        company,
        clientName,
        clientAddress,
        lineItems: resolvedItems,
        subtotal,
        vatAmount,
        total,
      });

      // Store PDF keyed by pdfRequestId so the controller can retrieve it (WhatsApp delivery).
      const pdfRequestId = context?.requestContext?.get("pdfRequestId") as string | undefined;
      if (pdfRequestId && pdfBase64) {
        pdfStore.set(pdfRequestId, { pdfBase64, filename });
      }

      // Store in shared AttachmentStore keyed by filename for cross-plugin retrieval
      // (e.g., Gmail can attach this PDF in a follow-up request).
      if (pdfBase64) {
        attachmentStore.store(filename, { base64: pdfBase64, mimetype: "application/pdf", filename });
      }

      return {
        success: true,
        clientName,
        lineItems: resolvedItems,
        subtotal,
        vatAmount,
        total,
        pdfBase64,
        filename,
        notFound,
      };
    },
  });
}
