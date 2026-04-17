import { tool } from "ai";
import { z } from "zod";
import type { Plugin } from "../plugin.interface.js";
import type { AgentTools } from "../../agent/types.js";
import type { AttachmentStore } from "../../domain/ports/attachment-store.js";
import type { OrganizationRepository } from "../../domain/ports/repositories/organization.repository.js";
import type { QuoteRepository } from "../../domain/ports/repositories/quote.repository.js";
import { createCalculateBudgetTool } from "./tools/calculate-budget.tool.js";
import { createListCatalogTool } from "./tools/list-catalog.tool.js";
import { createListQuotesTool } from "./tools/list-quotes.tool.js";
import { createQuoteAgent } from "./quote.agent.js";
import { QuoteStrategyRegistry } from "./strategies/index.js";
import { logger } from "../../shared/logger.js";

/** Creates a tool that always returns a fixed message. Used when quotes aren't configured. */
function stubTool(message: string) {
  return tool({
    description: message,
    inputSchema: z.object({}),
    execute: async () => ({ available: false, message }),
  });
}

export interface QuotePluginDeps {
  attachmentStore: AttachmentStore;
  organizationRepo: OrganizationRepository;
  quoteRepo: QuoteRepository;
}

export class QuotePlugin implements Plugin {
  readonly id = "quote";
  readonly name = "Quote Plugin";
  readonly description =
    "Genera presupuestos en PDF a partir de los datos del cliente. " +
    "La lógica de cálculo y la plantilla del PDF las aporta la lógica de " +
    "negocio remota configurada por la organización (businessLogicUrl). " +
    "Úsalo cuando el usuario pida 'un presupuesto', 'una oferta', o haya " +
    "que calcular un coste para un cliente.";
  readonly agent;
  readonly tools: AgentTools;

  private readonly attachmentStore: AttachmentStore;
  private readonly organizationRepo: OrganizationRepository;
  private readonly quoteRepo: QuoteRepository;
  private readonly strategyRegistry: QuoteStrategyRegistry;

  constructor({ attachmentStore, organizationRepo, quoteRepo }: QuotePluginDeps) {
    this.attachmentStore = attachmentStore;
    this.organizationRepo = organizationRepo;
    this.quoteRepo = quoteRepo;
    this.strategyRegistry = new QuoteStrategyRegistry();

    const calculateBudget = createCalculateBudgetTool({
      attachmentStore, organizationRepo, quoteRepo, strategyRegistry: this.strategyRegistry,
    });
    const listCatalog = createListCatalogTool({ organizationRepo, strategyRegistry: this.strategyRegistry });
    const listQuotes = createListQuotesTool({ quoteRepo });

    this.tools = { calculateBudget, listCatalog, listQuotes };
    this.agent = createQuoteAgent(this.tools);
  }

  /**
   * Per-org system prompt: pulled from the remote business function's
   * agentInstructions. Returns null if the org has no remote configured —
   * the delegation layer falls back to the agent's generic system prompt.
   */
  async resolveSystemForRequest(orgId: string, lang = "es"): Promise<string | null> {
    try {
      const org = await this.organizationRepo.findByOrgId(orgId);
      if (!org?.businessLogicUrl || !org.businessLogicApiKey) {
        return "Esta organización no tiene un servicio de presupuestos configurado. " +
          "Si el usuario pide generar un presupuesto, explícale que esta funcionalidad " +
          "no está disponible y que debe contactar con el administrador. " +
          "Solo puedes consultar presupuestos anteriores con listQuotes.";
      }

      const strategy = await this.strategyRegistry.resolveForOrg(org);
      const instructions = strategy.getAgentInstructions(lang);
      return instructions || null;
    } catch (err) {
      logger.warn({ err, orgId }, "[QuotePlugin] resolveSystemForRequest failed — using generic prompt");
      return null;
    }
  }

  /**
   * Per-org tools: rebuilds calculateBudget with the inputSchema/description
   * pulled from the org's remote business function. This is critical because
   * LLMs only generate fields declared in the tool's JSON Schema — without
   * the per-org schema the model never extracts business-specific fields
   * even with .passthrough() on the validator.
   *
   * Returns null if the org has no remote configured — the delegation layer
   * falls back to the plugin's static `tools` (clientName/clientAddress only).
   */
  async resolveToolsForRequest(orgId: string): Promise<AgentTools | null> {
    try {
      const org = await this.organizationRepo.findByOrgId(orgId);
      if (!org?.businessLogicUrl || !org.businessLogicApiKey) {
        logger.info({ orgId }, "[QuotePlugin] no businessLogicUrl — returning stub tools");
        return {
          calculateBudget: stubTool("La generación de presupuestos no está configurada para esta organización."),
          listCatalog: stubTool("El catálogo no está disponible."),
          listQuotes: this.tools["listQuotes"]!,
        };
      }

      const strategy = await this.strategyRegistry.resolveForOrg(org);

      const calculateBudget = createCalculateBudgetTool(
        {
          attachmentStore: this.attachmentStore,
          organizationRepo: this.organizationRepo,
          quoteRepo: this.quoteRepo,
          strategyRegistry: this.strategyRegistry,
        },
        {
          inputSchema: strategy.getInputSchema(),
          description: strategy.getToolDescription(),
        },
      );

      // listCatalog and listQuotes don't depend on per-org schema → reuse the static ones.
      return {
        calculateBudget,
        listCatalog: this.tools["listCatalog"]!,
        listQuotes: this.tools["listQuotes"]!,
      };
    } catch (err) {
      logger.warn({ err, orgId }, "[QuotePlugin] resolveToolsForRequest failed — using default tools");
      return null;
    }
  }
}
