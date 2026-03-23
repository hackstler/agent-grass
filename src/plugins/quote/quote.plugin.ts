import type { Plugin } from "../plugin.interface.js";
import type { AgentTools } from "../../agent/types.js";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import type { QuoteRepository } from "../../domain/ports/repositories/quote.repository.js";
import { CatalogService } from "./services/catalog.service.js";
import { PdfService } from "./services/pdf.service.js";
import { createCalculateBudgetTool } from "./tools/calculate-budget.tool.js";
import { createListCatalogTool } from "./tools/list-catalog.tool.js";
import { createListQuotesTool } from "./tools/list-quotes.tool.js";
import { createQuoteAgent } from "./quote.agent.js";
import { QuoteStrategyRegistry } from "./strategies/index.js";

export interface QuotePluginDeps {
  attachmentStore: AttachmentStore;
  organizationRepo: OrganizationRepository;
  quoteRepo: QuoteRepository;
}

export class QuotePlugin implements Plugin {
  readonly id = "quote";
  readonly name = "Quote Plugin";
  readonly description: string;
  readonly agent;
  readonly tools: AgentTools;

  constructor({ attachmentStore, organizationRepo, quoteRepo }: QuotePluginDeps) {
    const catalogService = new CatalogService();
    const pdfService = new PdfService();
    const strategyRegistry = new QuoteStrategyRegistry();
    const defaultStrategy = strategyRegistry.getDefault();

    const calculateBudget = createCalculateBudgetTool({
      catalogService, pdfService, attachmentStore, organizationRepo, quoteRepo, strategyRegistry,
    });
    const listCatalog = createListCatalogTool({ catalogService, strategy: defaultStrategy });
    const listQuotes = createListQuotesTool({ quoteRepo });

    this.description = `Generates price quotes and PDF invoices for ${defaultStrategy.displayName}. Can also list previously generated quotes.`;
    this.tools = { calculateBudget, listCatalog, listQuotes };
    this.agent = createQuoteAgent(this.tools, defaultStrategy);
  }

  // Tables are created by Drizzle migration — no raw SQL needed.
}
