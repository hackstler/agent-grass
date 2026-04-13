import { and, gte, lte, eq, sum, count, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { expenses } from "../db/schema.js";
import type { ExpenseRow } from "../db/schema.js";
import type { Expense, NewExpense, ExpenseSummary, ExpenseRepository } from "../../domain/ports/repositories/expense.repository.js";

/** Map a DB row (amount as string) to the domain entity (amount as number). */
function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    vendor: row.vendor,
    amount: Number(row.amount),
    vatAmount: row.vatAmount != null ? Number(row.vatAmount) : null,
    concept: row.concept,
    date: row.date,
    receiptAttachmentId: row.receiptAttachmentId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleExpenseRepository implements ExpenseRepository {
  async create(input: NewExpense): Promise<Expense> {
    const [row] = await db
      .insert(expenses)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        vendor: input.vendor,
        amount: String(input.amount),
        vatAmount: input.vatAmount != null ? String(input.vatAmount) : null,
        concept: input.concept ?? null,
        date: input.date,
        receiptAttachmentId: input.receiptAttachmentId ?? null,
      })
      .returning();

    return toExpense(row!);
  }

  async listByUser(userId: string, from: string, to: string): Promise<Expense[]> {
    const rows = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.userId, userId), gte(expenses.date, from), lte(expenses.date, to)))
      .orderBy(expenses.date);

    return rows.map(toExpense);
  }

  async summarizeByOrg(orgId: string, from: string, to: string): Promise<ExpenseSummary> {
    const where = and(eq(expenses.orgId, orgId), gte(expenses.date, from), lte(expenses.date, to));

    // Totals via SQL aggregation
    const [totals] = await db
      .select({
        totalAmount: sum(expenses.amount),
        totalVat: sum(expenses.vatAmount),
        count: count(),
      })
      .from(expenses)
      .where(where);

    // Per-vendor breakdown via SQL GROUP BY
    const vendorRows = await db
      .select({
        vendor: expenses.vendor,
        total: sum(expenses.amount),
        count: count(),
      })
      .from(expenses)
      .where(where)
      .groupBy(expenses.vendor)
      .orderBy(desc(sum(expenses.amount)));

    return {
      totalAmount: Number(totals?.totalAmount ?? 0),
      totalVat: Number(totals?.totalVat ?? 0),
      count: Number(totals?.count ?? 0),
      byVendor: vendorRows.map((r) => ({
        vendor: r.vendor,
        total: Number(r.total ?? 0),
        count: Number(r.count),
      })),
    };
  }
}
