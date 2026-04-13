import type { Expense, NewExpense, ExpenseSummary } from "../../domain/entities/index.js";
import type { ExpenseRepository } from "../../domain/ports/repositories/expense.repository.js";
import { periodToDates } from "../../plugins/expenses/utils/period.js";

export class ExpenseManager {
  constructor(private readonly repo: ExpenseRepository) {}

  async record(input: NewExpense): Promise<Expense> {
    if (!input.vendor.trim()) throw new Error("El proveedor no puede estar vacío");
    if (input.amount <= 0) throw new Error("El importe debe ser mayor que 0");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Fecha inválida — usa formato YYYY-MM-DD");

    return this.repo.create(input);
  }

  async listForPeriod(userId: string, period: string): Promise<Expense[]> {
    const { from, to } = periodToDates(period);
    return this.repo.listByUser(userId, from, to);
  }

  async summarize(orgId: string, period: string): Promise<ExpenseSummary & { period: string }> {
    const { from, to, label } = periodToDates(period);
    const summary = await this.repo.summarizeByOrg(orgId, from, to);
    return { ...summary, period: label };
  }
}
