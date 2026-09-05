import { useMemo } from "react";
import { IconTile } from "@/components/common/IconTile";
import { Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { StatePanel } from "@/components/common/StatePanel";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { useTasks } from "@/hooks/useTasks";
import { toDateOnly } from "@/lib/date";
import { cn } from "@/lib/utils";

export function TodaysFocusWidget() {
  const { tasks, isLoading, error, toggleTaskCompleted } = useTasks();

  const todayStr = useMemo(() => toDateOnly(new Date()), []);

  const focusTasks = useMemo(() => {
    return tasks
      .filter((t) => t.dueDate && t.dueDate <= todayStr)
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .slice(0, 5);
  }, [tasks, todayStr]);

  const doneCount = focusTasks.filter((t) => t.completed).length;
  const totalCount = focusTasks.length;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const isInitialLoading = isLoading && tasks.length === 0;

  return (
    <Card className="glass-card card-accent h-full flex flex-col">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
          <IconTile className="w-7 h-7 rounded-md"><Target className="w-3.5 h-3.5" /></IconTile>
          <div>
            <span>Today&apos;s Focus</span>
            <p className="text-[10px] font-normal text-muted-foreground mt-0.5">
              Due today &amp; overdue
            </p>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 text-sm flex-1">
        {error && !isInitialLoading ? (
          <StatePanel
            variant="error"
            title="Tasks unavailable"
            description={error}
          />
        ) : isInitialLoading ? (
          <div className="space-y-2">
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-3/4" />
            <SkeletonBlock className="h-4 w-5/6" />
          </div>
        ) : totalCount === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing due today — you&apos;re clear!
          </p>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {focusTasks.map((task) => {
                const isOverdue = task.dueDate !== todayStr;
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-2.5 rounded-md px-1 py-1 -mx-1 transition-colors hover:bg-secondary/30"
                  >
                    <Checkbox
                      checked={task.completed}
                      onCheckedChange={() => toggleTaskCompleted(task.id)}
                      className="shrink-0"
                    />
                    <span
                      className={cn(
                        "text-sm truncate flex-1 min-w-0",
                        task.completed &&
                          "line-through text-muted-foreground",
                      )}
                    >
                      {task.title}
                    </span>
                    {isOverdue && !task.completed && (
                      <span className="text-[10px] font-medium text-destructive shrink-0">
                        Overdue
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="space-y-1">
              <Progress value={pct} className="h-1.5" />
              <p className="text-[11px] text-muted-foreground">
                {doneCount} of {totalCount} done today
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
