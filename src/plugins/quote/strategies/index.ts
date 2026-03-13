import type { QuoteStrategy } from "./quote-strategy.interface.js";
import { GrassQuoteStrategy } from "./grass.strategy.js";

export type { QuoteStrategy } from "./quote-strategy.interface.js";
export type {
  QuoteComparisonRow,
  QuoteCalculationResult,
  PdfColumnDef,
} from "./quote-strategy.interface.js";
export { GrassQuoteStrategy } from "./grass.strategy.js";

/**
 * Registry that maps businessType → QuoteStrategy.
 *
 * At startup the QuotePlugin registers all known strategies.
 * At runtime the calculateBudget tool resolves the strategy from the catalog's businessType.
 *
 * Adding a new business type:
 *   1. Create a new class implementing QuoteStrategy (e.g. CleaningStrategy)
 *   2. Register it here with register()
 *   3. Create a catalog with businessType = "cleaning"
 *   → The agent, tool, and PDF automatically adapt.
 */
export class QuoteStrategyRegistry {
  private readonly strategies = new Map<string, QuoteStrategy>();

  /** The default strategy used when a catalog has no businessType or the type is unknown. */
  private defaultStrategy: QuoteStrategy;

  constructor() {
    // Grass is the default — backward compatible with existing catalogs
    const grass = new GrassQuoteStrategy();
    this.defaultStrategy = grass;
    this.strategies.set(grass.businessType, grass);
  }

  register(strategy: QuoteStrategy): void {
    this.strategies.set(strategy.businessType, strategy);
  }

  resolve(businessType: string | null | undefined): QuoteStrategy {
    if (!businessType) return this.defaultStrategy;
    return this.strategies.get(businessType) ?? this.defaultStrategy;
  }

  getDefault(): QuoteStrategy {
    return this.defaultStrategy;
  }

  getAllTypes(): string[] {
    return [...this.strategies.keys()];
  }
}
