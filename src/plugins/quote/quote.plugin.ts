import type { Plugin } from "../plugin.interface.js";
import type { ToolsInput } from "@mastra/core/agent";
import { pool } from "../../infrastructure/db/client.js";
import { CatalogService } from "./services/catalog.service.js";
import { PdfService } from "./services/pdf.service.js";
import { createCalculateBudgetTool } from "./tools/calculate-budget.tool.js";
import { createQuoteAgent } from "./quote.agent.js";

export class QuotePlugin implements Plugin {
  readonly id = "quote";
  readonly name = "Quote Plugin";
  readonly description = "Generates price quotes and PDF invoices for artificial grass installation.";
  readonly agent;
  readonly tools: ToolsInput;

  constructor() {
    const catalogService = new CatalogService();
    const pdfService = new PdfService();
    const calculateBudget = createCalculateBudgetTool({ catalogService, pdfService });

    this.tools = { calculateBudget };
    this.agent = createQuoteAgent(this.tools);
  }

  async ensureTables(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS catalogs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id text NOT NULL,
          name text NOT NULL,
          effective_date timestamp with time zone NOT NULL,
          is_active boolean DEFAULT true NOT NULL,
          created_at timestamp with time zone DEFAULT now() NOT NULL
        );
        CREATE TABLE IF NOT EXISTS catalog_items (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          catalog_id uuid NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
          code integer NOT NULL,
          name text NOT NULL,
          price_per_unit numeric(10, 2) NOT NULL,
          unit text NOT NULL,
          sort_order integer DEFAULT 0 NOT NULL,
          created_at timestamp with time zone DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS catalog_items_catalog_id_idx ON catalog_items(catalog_id);
      `);
    } finally {
      client.release();
    }
  }
}
