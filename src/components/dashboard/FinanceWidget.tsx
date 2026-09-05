import { useMemo } from "react";
import { IconTile } from "@/components/common/IconTile";
import { Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatePanel } from "@/components/common/StatePanel";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { useFinance } from "@/hooks/useFinance";
import { toDateOnly } from "@/lib/date";

function formatCurrency(amount: number) {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function FinanceWidget() {
  const { transactions, isLoading, error } = useFinance();
  const currentMonth = useMemo(() => toDateOnly(new Date()).slice(0, 7), []);

  const net = useMemo(() => {
    const monthTx = transactions.filter((tx) =>
      tx.date.startsWith(currentMonth)
    );
    const income = monthTx
      .filter((tx) => tx.type === "income")
      .reduce((s, tx) => s + tx.amount, 0);
    const expense = monthTx
      .filter((tx) => tx.type === "expense")
      .reduce((s, tx) => s + tx.amount, 0);
    return { value: income - expense, hasAny: monthTx.length > 0 };
  }, [transactions, currentMonth]);

  const isInitialLoading = isLoading && transactions.length === 0;

  return (
    <Card className="glass-card card-accent">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
          <IconTile className="w-7 h-7 rounded-md"><Wallet className="w-3.5 h-3.5" /></IconTile>
          Finance
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 text-sm">
        {error && !isInitialLoading ? (
          <StatePanel
            variant="error"
            title="Finance unavailable"
            description={error}
          />
        ) : isInitialLoading ? (
          <SkeletonBlock className="h-4 w-28" />
        ) : (
          <div className="space-y-1">
            <p className="text-2xl font-bold tracking-tight">
              {net.hasAny ? formatCurrency(net.value) : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {net.hasAny ? "Net this month" : "No transactions yet"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
