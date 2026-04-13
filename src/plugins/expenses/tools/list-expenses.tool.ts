import { tool } from "ai";
import { z } from "zod";
import { getAgentContextValue } from "../../../application/agent-context.js";
import type { ExpenseManager } from "../../../application/managers/expense.manager.js";

export function createListExpensesTool(expenseManager: ExpenseManager) {
  return tool({
    description:
      "Lista los gastos registrados del usuario en un período. " +
      "Usar para responder preguntas como '¿qué gasté en abril?' o '¿cuáles son mis últimos gastos?'",
    inputSchema: z.object({
      period: z
        .string()
        .describe(
          "Período en lenguaje natural: 'este mes', 'abril 2026', 'Q1 2026', 'este trimestre', " +
          "'enero', 'últimos 30 días'. Si no se especifica, usar el mes actual.",
        ),
    }),
    execute: async ({ period }, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      if (!userId) throw new Error("Contexto de usuario no disponible");

      const rows = await expenseManager.listForPeriod(userId, period);

      if (rows.length === 0) {
        return { count: 0, expenses: [], message: `No hay gastos registrados en ese período.` };
      }

      return {
        count: rows.length,
        expenses: rows.map((r) => ({
          id: r.id,
          vendor: r.vendor,
          amount: r.amount,
          vatAmount: r.vatAmount,
          concept: r.concept,
          date: r.date,
        })),
      };
    },
  });
}
