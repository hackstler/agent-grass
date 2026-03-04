import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CatalogService } from "../services/catalog.service.js";
import type { PdfService, QuoteLineItem } from "../services/pdf.service.js";
import { quoteConfig } from "../config/quote.config.js";

export interface CalculateBudgetDeps {
  catalogService: CatalogService;
  pdfService: PdfService;
}

export function createCalculateBudgetTool({ catalogService, pdfService }: CalculateBudgetDeps) {
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
      applyVat: z.boolean().default(true).describe("Whether to include 21% VAT"),
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

      const catalogId = await catalogService.getActiveCatalogId(orgId);
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
      const vatAmount = applyVat ? Math.round(subtotal * quoteConfig.vatRate * 100) / 100 : 0;
      const total = Math.round((subtotal + vatAmount) * 100) / 100;

      const now = new Date();
      const quoteNumber = `PRES-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Date.now().toString().slice(-4)}`;
      const dateStr = now.toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
      const filename = `${quoteNumber}.pdf`;

      const pdfBase64 = await pdfService.generateQuotePdf({
        quoteNumber,
        date: dateStr,
        clientName,
        clientAddress,
        lineItems: resolvedItems,
        subtotal,
        vatAmount,
        total,
      });

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
