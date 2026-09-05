import { useMemo } from "react";
import { IconTile } from "@/components/common/IconTile";
import { CheckSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatePanel } from "@/components/common/StatePanel";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { useTasks } from "@/hooks/useTasks";
import { isBeforeDay } from "@/lib/date";

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00`);
}

export function TasksWidget() {
  const { tasks, isLoading, error } = useTasks();
  const today = useMemo(() => new Date(), []);

  const incompleteCount = useMemo(
    () => tasks.filter((t) => !t.completed).length,
    [tasks]
  );

  const mostUrgent = useMemo(() => {
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + 7);
    const due = tasks
      .filter((task) => !task.completed && task.dueDate)
      .map((task) => ({ task, due: parseDateOnly(task.dueDate!) }))
      .filter(({ due: d }) => !isBeforeDay(d, today) && d <= windowEnd)
      .sort((a, b) => a.due.getTime() - b.due.getTime());
    return due[0]?.task ?? null;
  }, [tasks, today]);

  const isInitialLoading = isLoading && tasks.length === 0;

  return (
    <Card className="glass-card card-accent">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
          <IconTile className="w-7 h-7 rounded-md"><CheckSquare className="w-3.5 h-3.5" /></IconTile>
          Tasks
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 text-sm">
        {error && !isInitialLoading ? (
          <StatePanel
            variant="error"
            title="Tasks unavailable"
            description={error}
          />
        ) : isInitialLoading ? (
          <SkeletonBlock className="h-4 w-24" />
        ) : (
          <div className="space-y-1">
            <p className="text-2xl font-bold tracking-tight">
              {incompleteCount}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {mostUrgent ? mostUrgent.title : "No tasks due"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
