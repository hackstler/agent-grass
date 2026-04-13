import type { Plugin } from "../plugin.interface.js";
import type { AgentTools } from "../../agent/types.js";
import type { ExpenseManager } from "../../application/managers/expense.manager.js";
import { createRecordExpenseTool } from "./tools/record-expense.tool.js";
import { createListExpensesTool } from "./tools/list-expenses.tool.js";
import { createGetExpenseSummaryTool } from "./tools/get-expense-summary.tool.js";
import { createExpensesAgent } from "./expenses.agent.js";

export interface ExpensesPluginDeps {
  expenseManager: ExpenseManager;
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

  constructor({ expenseManager }: ExpensesPluginDeps) {
    const recordExpense = createRecordExpenseTool(expenseManager);
    const listExpenses = createListExpensesTool(expenseManager);
    const getExpenseSummary = createGetExpenseSummaryTool(expenseManager);

    this.tools = { recordExpense, listExpenses, getExpenseSummary };
    this.agent = createExpensesAgent(this.tools);
  }
}
