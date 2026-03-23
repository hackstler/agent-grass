import type { Plugin } from "../plugin.interface.js";
import type { AgentTools } from "../../agent/types.js";
import type { CatalogManager } from "../../application/managers/catalog.manager.js";
import type { CatalogRepository } from "../../domain/ports/repositories/catalog.repository.js";
import { entityEvents, type EntityEvent } from "../../application/events/entity-events.js";
import { CatalogIndexer } from "./services/catalog-indexer.js";
import { createCatalogCrudTools } from "./tools/index.js";
import { createCatalogManagerAgent } from "./catalog-manager.agent.js";
import { logger } from "../../shared/logger.js";

export interface CatalogManagerPluginDeps {
  catalogManager: CatalogManager;
  catalogRepo: CatalogRepository;
}

export class CatalogManagerPlugin implements Plugin {
  readonly id = "catalog-manager";
  readonly name = "Catalog Manager Plugin";
  readonly description =
    "Catalog/product management: create catalogs, add/update/delete products and prices, list products.";
  readonly agent;
  readonly tools: AgentTools;

  private readonly catalogIndexer: CatalogIndexer;
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listener: ((event: EntityEvent) => void) | null = null;

  constructor({ catalogManager, catalogRepo }: CatalogManagerPluginDeps) {
    this.catalogIndexer = new CatalogIndexer(catalogRepo);
    this.tools = createCatalogCrudTools(catalogManager);
    this.agent = createCatalogManagerAgent(this.tools);
  }

  async initialize(): Promise<void> {
    // Subscribe to entity events for auto re-indexing
    this.listener = (event: EntityEvent) => {
      if (!event.type.startsWith("catalog:")) return;

      // Determine which catalog changed
      const catalogId = event.type.startsWith("catalog:item:")
        ? event.relatedId!
        : event.entityId;
      const orgId = event.orgId;

      // Debounce: collapse rapid mutations into a single re-index
      const key = catalogId;
      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(
        key,
        setTimeout(() => {
          this.debounceTimers.delete(key);

          if (event.type === "catalog:deleted") {
            this.catalogIndexer.remove(catalogId).catch((err) => {
              logger.error({ err, catalogId }, "Failed to remove catalog index");
            });
          } else {
            this.catalogIndexer.index(orgId, catalogId).catch((err) => {
              logger.error({ err, catalogId }, "Failed to re-index catalog");
            });
          }
        }, 2000)
      );
    };

    entityEvents.on("entity", this.listener);

    // Index all existing catalogs on startup
    logger.info("Indexing existing catalogs on startup");
    try {
      const { indexed, failed } = await this.catalogIndexer.indexAllOrgs();
      logger.info({ indexed, failed }, "Startup catalog indexing complete");
    } catch (err) {
      logger.error({ err }, "Startup catalog indexing error (non-fatal)");
    }
  }

  async shutdown(): Promise<void> {
    if (this.listener) {
      entityEvents.off("entity", this.listener);
      this.listener = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
