import type { Expense, NewExpense, ExpenseSummary } from "../../entities/index.js";

export type { Expense, NewExpense, ExpenseSummary };

export interface ExpenseRepository {
  create(input: NewExpense): Promise<Expense>;
  listByUser(userId: string, from: string, to: string): Promise<Expense[]>;
  summarizeByOrg(orgId: string, from: string, to: string): Promise<ExpenseSummary>;
}
