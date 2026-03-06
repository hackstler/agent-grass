import type { Plugin } from "../plugin.interface.js";
import type { ToolsInput } from "@mastra/core/agent";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import { CatalogService } from "./services/catalog.service.js";
import { PdfService } from "./services/pdf.service.js";
import { createCalculateBudgetTool } from "./tools/calculate-budget.tool.js";
import { createQuoteAgent } from "./quote.agent.js";

export interface QuotePluginDeps {
  attachmentStore: AttachmentStore;
  organizationRepo: OrganizationRepository;
}

export class QuotePlugin implements Plugin {
  readonly id = "quote";
  readonly name = "Quote Plugin";
  readonly description = "Generates price quotes and PDF invoices for artificial grass installation.";
  readonly agent;
  readonly tools: ToolsInput;

  constructor({ attachmentStore, organizationRepo }: QuotePluginDeps) {
    const catalogService = new CatalogService();
    const pdfService = new PdfService();
    const calculateBudget = createCalculateBudgetTool({ catalogService, pdfService, attachmentStore, organizationRepo });

    this.tools = { calculateBudget };
    this.agent = createQuoteAgent(this.tools);
  }

  // Tables are created by Drizzle migration 0006_add_catalog_tables.sql
  // No raw SQL needed here — migrations are the single source of truth.
}
