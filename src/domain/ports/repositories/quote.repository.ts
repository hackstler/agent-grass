import type { Quote, NewQuote } from "../../entities/index.js";

export interface QuoteRepository {
  findByOrg(orgId: string): Promise<Quote[]>;
  findByUser(userId: string): Promise<Quote[]>;
  findById(id: string, orgId: string): Promise<Quote | null>;
  create(data: NewQuote): Promise<Quote>;
  deleteByOrg(orgId: string): Promise<void>;
}
