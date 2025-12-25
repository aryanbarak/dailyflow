import { useCallback, useEffect, useState } from "react";
import { Transaction, financeService } from "@/features/finance/financeService";

export function useFinance() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(() => {
    setTransactions(financeService.getAll());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addTransaction = useCallback(
    (input: Omit<Transaction, "id" | "createdAt" | "updatedAt">) => {
      const created = financeService.create(input);
      setTransactions((prev) => [created, ...prev]);
      return created;
    },
    [],
  );

  const updateTransaction = useCallback(
    (id: string, updates: Partial<Omit<Transaction, "id" | "createdAt">>) => {
      const updated = financeService.update(id, updates);
      if (!updated) return null;
      setTransactions((prev) => prev.map((tx) => (tx.id === id ? updated : tx)));
      return updated;
    },
    [],
  );

  const removeTransaction = useCallback((id: string) => {
    const removed = financeService.remove(id);
    if (removed) {
      setTransactions((prev) => prev.filter((tx) => tx.id !== id));
    }
    return removed;
  }, []);

  return {
    transactions,
    isLoading,
    refresh,
    addTransaction,
    updateTransaction,
    removeTransaction,
  };
}
