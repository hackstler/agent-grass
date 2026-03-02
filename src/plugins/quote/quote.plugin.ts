import type { Plugin } from "../plugin.interface.js";
import { quoteAgent, quoteTools } from "./quote.agent.js";

export class QuotePlugin implements Plugin {
  readonly id = "quote";
  readonly name = "Quote Plugin";
  readonly description = "Generates price quotes and PDF invoices for artificial grass installation. Use when the user asks to create a budget or presupuesto for a client.";
  readonly agent = quoteAgent;
  readonly tools = quoteTools;
}
