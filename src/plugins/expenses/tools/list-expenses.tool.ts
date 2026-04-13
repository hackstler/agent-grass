import { tool } from "ai";
import { z } from "zod";
import { getAgentContextValue } from "../../../application/agent-context.js";
import type { ExpenseRepository } from "../../../domain/ports/repositories/expense.repository.js";
import { periodToDates } from "../utils/period.js";

export function createListExpensesTool(expenseRepo: ExpenseRepository) {
  return tool({
    description:
      "Lista los gastos registrados del usuario en un período. " +
      "Usar para responder preguntas como '¿qué gasté en abril?' o '¿cuáles son mis últimos gastos?'",
    inputSchema: z.object({
      period: z
        .string()
        .describe(
          "Período en lenguaje natural: 'este mes', 'abril 2026', 'Q1 2026', 'este trimestre', " +
          "'enero', 'últimos 30 días', etc. Si no se especifica, usar el mes actual.",
        ),
    }),
    execute: async ({ period }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId") ?? "";

      const { from, to, label } = periodToDates(period);
      const rows = await expenseRepo.listByUser(userId, from, to);

      if (rows.length === 0) {
        return { period: label, count: 0, expenses: [], message: `No hay gastos registrados en ${label}.` };
      }

      return {
        period: label,
        count: rows.length,
        expenses: rows.map((r) => ({
          id: r.id,
          vendor: r.vendor,
          amount: Number(r.amount),
          vatAmount: r.vatAmount != null ? Number(r.vatAmount) : null,
          concept: r.concept,
          date: r.date,
        })),
      };
    },
  });
}
