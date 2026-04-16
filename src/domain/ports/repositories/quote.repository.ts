import type { Quote, NewQuote } from "../../entities/index.js";

export interface QuoteRepository {
  findByOrg(orgId: string): Promise<Quote[]>;
  findByUser(userId: string): Promise<Quote[]>;
  findById(id: string, orgId: string): Promise<Quote | null>;
  /**
   * Find the most recent quote for a user matching a deterministic input hash,
   * created within the given time window. Used by calculateBudget for
   * idempotent regeneration short-circuit.
   */
  findRecentByUserAndHash(
    userId: string,
    inputHash: string,
    sinceMs: number,
  ): Promise<Quote | null>;
  create(data: NewQuote): Promise<Quote>;
  deleteByOrg(orgId: string): Promise<void>;
}
