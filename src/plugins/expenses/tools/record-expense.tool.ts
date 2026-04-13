import { tool } from "ai";
import { z } from "zod";
import { getAgentContextValue } from "../../../application/agent-context.js";
import type { ExpenseManager } from "../../../application/managers/expense.manager.js";

export function createRecordExpenseTool(expenseManager: ExpenseManager) {
  return tool({
    description:
      "Guarda un gasto confirmado por el usuario en la base de datos. " +
      "Usar SOLO después de que el usuario haya confirmado explícitamente los datos del gasto. " +
      "Extrae los datos de la imagen o del texto del usuario antes de llamar a esta herramienta.",
    inputSchema: z.object({
      vendor: z.string().min(1).describe("Nombre del proveedor o establecimiento (ej: 'Repsol', 'El Corte Inglés')"),
      amount: z.number().positive().describe("Importe TOTAL en euros (con IVA incluido)"),
      vatAmount: z.number().min(0).optional().describe("Importe del IVA en euros (si aparece en la factura)"),
      concept: z.string().optional().describe("Descripción del gasto (ej: 'Gasolina', 'Material de oficina')"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha del gasto en formato YYYY-MM-DD"),
    }),
    execute: async (input, { experimental_context }) => {
      const userId = getAgentContextValue({ experimental_context }, "userId");
      const orgId = getAgentContextValue({ experimental_context }, "orgId");
      if (!userId || !orgId) throw new Error("Contexto de usuario no disponible");

      const expense = await expenseManager.record({
        orgId,
        userId,
        vendor: input.vendor,
        amount: input.amount,
        date: input.date,
        ...(input.vatAmount != null ? { vatAmount: input.vatAmount } : {}),
        ...(input.concept ? { concept: input.concept } : {}),
      });

      return {
        success: true,
        expenseId: expense.id,
        vendor: expense.vendor,
        amount: expense.amount,
        date: expense.date,
        message: `Gasto guardado correctamente (ID: ${expense.id})`,
      };
    },
  });
}
