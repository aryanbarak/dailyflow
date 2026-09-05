import { useMemo } from "react";
import { IconTile } from "@/components/common/IconTile";
import {
  CheckCircle2,
  Flame,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { useFinance } from "@/hooks/useFinance";
import { useHabits } from "@/features/habits/useHabits";
import { useTasks } from "@/hooks/useTasks";
import { toDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";

interface Insight {
  key: string;
  icon: React.ReactNode;
  text: string;
}

function useInsights(): { insights: Insight[]; isLoading: boolean; allErrored: boolean } {
  const {
    transactions,
    isLoading: finLoading,
    error: finError,
  } = useFinance();
  const { data: habits, isLoading: habLoading, error: habError } = useHabits();
  const { tasks, isLoading: taskLoading, error: taskError } = useTasks();

  const isLoading = finLoading || habLoading || taskLoading;
  const allErrored = !!finError && !!habError && !!taskError;

  const insights = useMemo(() => {
    if (isLoading) return [];
    const result: Insight[] = [];

    // Insight 1 — spending trend
    if (!finError && transactions.length > 0) {
      const today = toDateOnly(new Date());
      const curMonth = today.slice(0, 7);
      const prevDate = new Date();
      prevDate.setMonth(prevDate.getMonth() - 1);
      const prevMonth = toDateOnly(prevDate).slice(0, 7);

      const curExpenses = transactions
        .filter((tx) => tx.type === "expense" && tx.date.startsWith(curMonth))
        .reduce((s, tx) => s + tx.amount, 0);
      const prevExpenses = transactions
        .filter((tx) => tx.type === "expense" && tx.date.startsWith(prevMonth))
        .reduce((s, tx) => s + tx.amount, 0);

      if (prevExpenses > 0) {
        const pct = Math.round(
          ((curExpenses - prevExpenses) / prevExpenses) * 100,
        );
        const higher = pct >= 0;
        result.push({
          key: "spending",
          icon: higher ? (
            <TrendingUp className="w-3.5 h-3.5 text-destructive" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
          ),
          text: `Expenses are ${Math.abs(pct)}% ${higher ? "higher" : "lower"} than last month`,
        });
      }
    }

    // Insight 2 — habits today
    if (!habError && habits && habits.length > 0) {
      const doneToday = habits.filter((h) => h.completedToday).length;
      result.push({
        key: "habits",
        icon: <Flame className="w-3.5 h-3.5 text-orange-400" />,
        text: `${doneToday} of ${habits.length} habits done today`,
      });
    }

    // Insight 3 — task completion
    if (!taskError && tasks.length > 0) {
      const completed = tasks.filter((t) => t.completed).length;
      const pct = Math.round((completed / tasks.length) * 100);
      result.push({
        key: "tasks",
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-primary" />,
        text: `${pct}% of your tasks are complete`,
      });
    }

    return result;
  }, [isLoading, transactions, habits, tasks, finError, habError, taskError]);

  return { insights, isLoading, allErrored };
}

export function AiInsightsWidget() {
  const { insights, isLoading, allErrored } = useInsights();

  return (
    <Card className="glass-card card-accent h-full flex flex-col">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
          <IconTile className="w-7 h-7 rounded-md"><Sparkles className="w-3.5 h-3.5" /></IconTile>
          <div>
            <span>AI Insights</span>
            <p className="text-[10px] font-normal text-muted-foreground mt-0.5">
              Based on your activity
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 text-sm flex-1">
        {isLoading ? (
          <div className="space-y-2.5">
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-3/4" />
            <SkeletonBlock className="h-4 w-5/6" />
          </div>
        ) : allErrored ? (
          <p className="text-xs text-muted-foreground">
            Unable to load insights right now.
          </p>
        ) : insights.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Insights will appear here as you use the app.
          </p>
        ) : (
          <ul className="space-y-2">
            {insights.map((ins) => (
              <li
                key={ins.key}
                className={cn(
                  "flex items-start gap-2.5 rounded-md px-1 py-1.5 -mx-1",
                  "bg-secondary/20",
                )}
              >
                <div className="mt-0.5 shrink-0">{ins.icon}</div>
                <span className="text-[13px] leading-snug">{ins.text}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
