export interface Expense {
  id: string;
  orgId: string;
  userId: string;
  vendor: string;
  amount: string;        // numeric as string (DB precision)
  vatAmount: string | null;
  concept: string | null;
  date: string;          // YYYY-MM-DD
  receiptAttachmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExpenseInput {
  orgId: string;
  userId: string;
  vendor: string;
  amount: number;
  vatAmount?: number;
  concept?: string;
  date: string;          // YYYY-MM-DD
  receiptAttachmentId?: string;
}

export interface ExpenseSummary {
  totalAmount: number;
  totalVat: number;
  count: number;
  byVendor: { vendor: string; total: number; count: number }[];
}

export interface ExpenseRepository {
  create(input: CreateExpenseInput): Promise<Expense>;
  listByOrg(orgId: string, from: string, to: string): Promise<Expense[]>;
  listByUser(userId: string, from: string, to: string): Promise<Expense[]>;
  summarizeByOrg(orgId: string, from: string, to: string): Promise<ExpenseSummary>;
}
