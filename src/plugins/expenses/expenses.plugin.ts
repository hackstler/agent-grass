import type { Plugin } from "../plugin.interface.js";
import type { AgentTools } from "../../agent/types.js";
import type { ExpenseManager } from "../../application/managers/expense.manager.js";
import type { DriveApiService } from "../drive/services/drive-api.service.js";
import { createRecordExpenseTool } from "./tools/record-expense.tool.js";
import { createListExpensesTool } from "./tools/list-expenses.tool.js";
import { createGetExpenseSummaryTool } from "./tools/get-expense-summary.tool.js";
import { createUploadReceiptTool } from "./tools/upload-receipt.tool.js";
import { createExpensesAgent } from "./expenses.agent.js";

export interface ExpensesPluginDeps {
  expenseManager: ExpenseManager;
  driveService?: DriveApiService;
}

export class ExpensesPlugin implements Plugin {
  readonly id = "expenses";
  readonly name = "Expenses Plugin";
  readonly description =
    "Gestión de gastos y facturas para autónomos. " +
    "Registra gastos a partir de imágenes de facturas o tickets (extracción con Gemini Vision). " +
    "Permite consultar gastos por período y obtener resúmenes trimestrales para la declaración de IVA. " +
    "Si el usuario tiene Google Drive conectado, archiva el comprobante en /Facturas/{año}-Q{trimestre}/.";
  readonly agent;
  readonly tools: AgentTools;

  constructor({ expenseManager, driveService }: ExpensesPluginDeps) {
    const recordExpense = createRecordExpenseTool(expenseManager);
    const listExpenses = createListExpensesTool(expenseManager);
    const getExpenseSummary = createGetExpenseSummaryTool(expenseManager);

    this.tools = { recordExpense, listExpenses, getExpenseSummary } as AgentTools;

    if (driveService) {
      (this.tools as Record<string, unknown>)["uploadReceiptToDrive"] = createUploadReceiptTool(driveService);
    }

    this.agent = createExpensesAgent(this.tools);
  }
}
