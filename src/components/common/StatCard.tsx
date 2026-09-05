import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// DESIGN-AUDIT phase 4: the KPI/stat tile every page hand-rolled (icon
// tile + muted label above a big number, on a glass card). Markup is the
// exact block that lived inline on Calendar/Tasks/Habits/Finance/Family/
// Documents/Journal/Photos/Settings; `tileClassName`/`iconClassName`
// carry the per-page flow-token tint and `valueClassName` the rare value
// color (e.g. Finance's income/expense).
export function StatCard({
  icon: Icon,
  label,
  value,
  tileClassName,
  iconClassName,
  valueClassName,
  sub,
}: Readonly<{
  icon: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  tileClassName?: string;
  iconClassName?: string;
  valueClassName?: string;
  /** Optional caption line under the value (rendered in the standard small muted style). */
  sub?: ReactNode;
}>) {
  return (
    <Card className="glass-card card-accent surface-elevated">
      <CardContent className="p-3.5">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={cn("icon-tile w-8 h-8 rounded-md", tileClassName)}>
            <Icon className={cn("w-4 h-4", iconClassName ?? "text-primary")} />
          </div>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <p className={cn("text-2xl font-bold tracking-tight", valueClassName)}>{value}</p>
        {sub !== undefined && sub !== null && (
          <p className="text-[11px] text-muted-foreground">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}
