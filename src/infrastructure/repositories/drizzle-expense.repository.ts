import { and, gte, lte, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { expenses } from "../db/schema.js";
import type {
  Expense,
  CreateExpenseInput,
  ExpenseSummary,
  ExpenseRepository,
} from "../../domain/ports/repositories/expense.repository.js";

export class DrizzleExpenseRepository implements ExpenseRepository {
  async create(input: CreateExpenseInput): Promise<Expense> {
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

    return row!;
  }

  async listByOrg(orgId: string, from: string, to: string): Promise<Expense[]> {
    return db
      .select()
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), gte(expenses.date, from), lte(expenses.date, to)))
      .orderBy(expenses.date);
  }

  async listByUser(userId: string, from: string, to: string): Promise<Expense[]> {
    return db
      .select()
      .from(expenses)
      .where(and(eq(expenses.userId, userId), gte(expenses.date, from), lte(expenses.date, to)))
      .orderBy(expenses.date);
  }

  async summarizeByOrg(orgId: string, from: string, to: string): Promise<ExpenseSummary> {
    const rows = await db
      .select()
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), gte(expenses.date, from), lte(expenses.date, to)));

    const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const totalVat = rows.reduce((sum, r) => sum + Number(r.vatAmount ?? 0), 0);

    const vendorMap = new Map<string, { total: number; count: number }>();
    for (const r of rows) {
      const entry = vendorMap.get(r.vendor) ?? { total: 0, count: 0 };
      entry.total += Number(r.amount);
      entry.count += 1;
      vendorMap.set(r.vendor, entry);
    }

    return {
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalVat: Math.round(totalVat * 100) / 100,
      count: rows.length,
      byVendor: [...vendorMap.entries()]
        .map(([vendor, v]) => ({ vendor, total: Math.round(v.total * 100) / 100, count: v.count }))
        .sort((a, b) => b.total - a.total),
    };
  }
}
