import { createId } from "@/lib/id";
import { safeGet, safeSet, storageKey } from "@/lib/storage";

export type TransactionType = "income" | "expense";

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

const TRANSACTIONS_KEY = storageKey("transactions");

function readAll(): Transaction[] {
  return safeGet<Transaction[]>(TRANSACTIONS_KEY, []);
}

function writeAll(transactions: Transaction[]) {
  safeSet(TRANSACTIONS_KEY, transactions);
}

export const financeService = {
  getAll() {
    return readAll();
  },
  create(input: Omit<Transaction, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const transaction: Transaction = {
      id: createId(),
      type: input.type,
      amount: input.amount,
      category: input.category,
      date: input.date,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const transactions = [transaction, ...readAll()];
    writeAll(transactions);
    return transaction;
  },
  update(id: string, updates: Partial<Omit<Transaction, "id" | "createdAt">>) {
    const transactions = readAll();
    const index = transactions.findIndex((tx) => tx.id === id);
    if (index === -1) return null;
    const updated: Transaction = {
      ...transactions[index],
      ...updates,
      category: updates.category ? updates.category.trim() : transactions[index].category,
      notes: updates.notes !== undefined ? updates.notes.trim() || undefined : transactions[index].notes,
      updatedAt: new Date().toISOString(),
    };
    transactions[index] = updated;
    writeAll(transactions);
    return updated;
  },
  remove(id: string) {
    const transactions = readAll();
    const next = transactions.filter((tx) => tx.id !== id);
    if (next.length === transactions.length) return false;
    writeAll(next);
    return true;
  },
};
