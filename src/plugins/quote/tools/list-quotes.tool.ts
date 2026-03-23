import { tool } from "ai";
import { z } from "zod";
import type { QuoteRepository } from "../../../domain/ports/repositories/quote.repository.js";
import { getAgentContextValue } from "../../../application/agent-context.js";

export interface ListQuotesDeps {
  quoteRepo: QuoteRepository;
}

export function createListQuotesTool({ quoteRepo }: ListQuotesDeps) {
  return tool({
    description:
      `List previously generated quotes/budgets for the current user.
Use this tool to find the exact filename of a quote before sending it by email.
Optionally filter by client name (partial match). Returns the most recent quotes first.`,
    inputSchema: z.object({
      clientName: z
        .string()
        .optional()
        .describe("Filter by client name (partial, case-insensitive match)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .default(10)
        .describe("Maximum number of quotes to return (default 10)"),
    }),
    execute: async ({ clientName, limit }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) {
        return { success: false, quotes: [], error: "Missing userId in request context" };
      }

      const allQuotes = await quoteRepo.findByUser(userId);

      let filtered = allQuotes;
      if (clientName) {
        const needle = clientName.toLowerCase();
        filtered = allQuotes.filter((q) => q.clientName.toLowerCase().includes(needle));
      }

      // Sort by createdAt desc, take limit
      const sorted = filtered
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);

      return {
        success: true,
        quotes: sorted.map((q) => ({
          quoteNumber: q.quoteNumber,
          clientName: q.clientName,
          filename: q.filename,
          total: q.total,
          createdAt: q.createdAt.toISOString(),
        })),
      };
    },
  });
}
