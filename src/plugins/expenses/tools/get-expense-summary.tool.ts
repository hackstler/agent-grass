import { tool } from "ai";
import { z } from "zod";
import { getAgentContextValue } from "../../../application/agent-context.js";
import type { ExpenseManager } from "../../../application/managers/expense.manager.js";

export function createGetExpenseSummaryTool(expenseManager: ExpenseManager) {
  return tool({
    description:
      "Devuelve un resumen agregado de gastos por período: total, IVA deducible, y desglose por proveedor. " +
      "Ideal para preguntas como '¿cuánto gasté este trimestre?' o '¿cuál es mi IVA deducible de enero?'",
    inputSchema: z.object({
      period: z
        .string()
        .describe(
          "Período en lenguaje natural: 'este mes', 'Q1 2026', 'este trimestre', 'enero', etc.",
        ),
    }),
    execute: async ({ period }, { experimental_context }) => {
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!orgId) throw new Error("Contexto de organización no disponible");

      const summary = await expenseManager.summarize(orgId, period);

      return {
        period: summary.period,
        totalAmount: summary.totalAmount,
        totalVat: summary.totalVat,
        netAmount: Math.round((summary.totalAmount - summary.totalVat) * 100) / 100,
        count: summary.count,
        byVendor: summary.byVendor,
      };
    },
  });
}
