import { eq, and, desc, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { quotes } from "../db/schema.js";
import type { QuoteRepository } from "../../domain/ports/repositories/quote.repository.js";
import type { Quote, NewQuote } from "../../domain/entities/index.js";

const QUOTE_SELECT = {
  id: quotes.id,
  orgId: quotes.orgId,
  userId: quotes.userId,
  quoteNumber: quotes.quoteNumber,
  clientName: quotes.clientName,
  clientAddress: quotes.clientAddress,
  lineItems: quotes.lineItems,
  subtotal: quotes.subtotal,
  vatAmount: quotes.vatAmount,
  total: quotes.total,
  pdfBase64: quotes.pdfBase64,
  filename: quotes.filename,
  quoteData: quotes.quoteData,
  surfaceType: quotes.surfaceType,
  areaM2: quotes.areaM2,
  perimeterLm: quotes.perimeterLm,
  province: quotes.province,
  inputHash: quotes.inputHash,
  createdAt: quotes.createdAt,
} as const;

export class DrizzleQuoteRepository implements QuoteRepository {
  async findByOrg(orgId: string): Promise<Quote[]> {
    return db
      .select(QUOTE_SELECT)
      .from(quotes)
      .where(eq(quotes.orgId, orgId))
      .orderBy(desc(quotes.createdAt));
  }

  async findByUser(userId: string): Promise<Quote[]> {
    return db
      .select(QUOTE_SELECT)
      .from(quotes)
      .where(eq(quotes.userId, userId))
      .orderBy(desc(quotes.createdAt));
  }

  async findById(id: string, orgId: string): Promise<Quote | null> {
    const result = await db.query.quotes.findFirst({
      where: and(eq(quotes.id, id), eq(quotes.orgId, orgId)),
    });
    return (result as Quote | undefined) ?? null;
  }

  async findRecentByUserAndHash(
    userId: string,
    inputHash: string,
    sinceMs: number,
  ): Promise<Quote | null> {
    const cutoff = new Date(Date.now() - sinceMs);
    const [row] = await db
      .select(QUOTE_SELECT)
      .from(quotes)
      .where(
        and(
          eq(quotes.userId, userId),
          eq(quotes.inputHash, inputHash),
          gte(quotes.createdAt, cutoff),
        ),
      )
      .orderBy(desc(quotes.createdAt))
      .limit(1);
    return row ?? null;
  }

  async create(data: NewQuote): Promise<Quote> {
    const [quote] = await db.insert(quotes).values(data).returning();
    return quote as Quote;
  }

  async deleteByOrg(orgId: string): Promise<void> {
    await db.delete(quotes).where(eq(quotes.orgId, orgId));
  }
}
