import { useMemo } from "react";
import { IconTile } from "@/components/common/IconTile";
import { Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { useEvents } from "@/hooks/useEvents";
import { isSameDay } from "@/lib/date";

export function TodayWidget() {
  const { events, isLoading } = useEvents();
  const today = useMemo(() => new Date(), []);

  const todayEvents = useMemo(() => {
    const seen = new Set<string>();
    return events
      .filter((event) => isSameDay(new Date(event.dateTimeStart), today))
      .filter((event) => {
        const key = `${event.title}|${event.dateTimeStart}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.dateTimeStart).getTime() -
          new Date(b.dateTimeStart).getTime()
      );
  }, [events, today]);

  const isInitialLoading = isLoading && events.length === 0;
  const next = todayEvents[0] ?? null;
  const remaining = todayEvents.length - 1;

  return (
    <Card className="glass-card card-accent">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2.5">
          <IconTile className="w-7 h-7 rounded-md"><Calendar className="w-3.5 h-3.5" /></IconTile>
          Today
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 text-sm">
        {isInitialLoading ? (
          <SkeletonBlock className="h-4 w-28" />
        ) : next ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{next.title}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {new Date(next.dateTimeStart).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {remaining > 0 && (
              <p className="text-[11px] text-muted-foreground">
                +{remaining} more
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No events today.</p>
        )}
      </CardContent>
    </Card>
  );
}
