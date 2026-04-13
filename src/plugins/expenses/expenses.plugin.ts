import type { Plugin } from "../plugin.interface.js";
import type { AgentTools } from "../../agent/types.js";
import type { ExpenseRepository } from "../../domain/ports/repositories/expense.repository.js";
import { createRecordExpenseTool } from "./tools/record-expense.tool.js";
import { createListExpensesTool } from "./tools/list-expenses.tool.js";
import { createGetExpenseSummaryTool } from "./tools/get-expense-summary.tool.js";
import { createExpensesAgent } from "./expenses.agent.js";

export interface ExpensesPluginDeps {
  expenseRepo: ExpenseRepository;
}

export class ExpensesPlugin implements Plugin {
  readonly id = "expenses";
  readonly name = "Expenses Plugin";
  readonly description =
    "Gestión de gastos y facturas para autónomos. " +
    "Registra gastos a partir de imágenes de facturas o tickets (extracción con Gemini Vision). " +
    "Permite consultar gastos por período y obtener resúmenes trimestrales para la declaración de IVA.";
  readonly agent;
  readonly tools: AgentTools;

  constructor({ expenseRepo }: ExpensesPluginDeps) {
    const recordExpense = createRecordExpenseTool(expenseRepo);
    const listExpenses = createListExpensesTool(expenseRepo);
    const getExpenseSummary = createGetExpenseSummaryTool(expenseRepo);

    this.tools = { recordExpense, listExpenses, getExpenseSummary };
    this.agent = createExpensesAgent(this.tools);
  }
}
