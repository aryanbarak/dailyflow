import type { ReactNode } from "react";
import { ArrowRight, Lightbulb, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { IconTile } from "@/components/common/IconTile";
import { cn } from "@/lib/utils";

export interface AiSuggestionRow {
  text: string;
  /** 'action' renders the ArrowRight chip, 'idea' the Lightbulb chip. */
  kind: "action" | "idea";
  /** When set, the row is a button. */
  onClick?: () => void;
}

// DESIGN-AUDIT phase 4: the Gemini-suggestions card Tasks, Habits,
// Calendar and Finance each hand-rolled. One shell (sparkles header +
// optional subtitle + two-skeleton loading state + suggestion rows) with
// the small per-page differences as props; chip colors are unified on the
// flow tokens (analyze = action, study = idea) -- Habits' one-off
// emerald/violet pair was folded into the token pair, and rows use
// text-start so fa/RTL aligns correctly (Habits/Tasks had text-left or
// nothing).
export function AiSuggestionsCard({
  title,
  subtitle,
  isLoading,
  rows,
  empty,
  footer,
}: Readonly<{
  title: string;
  subtitle?: string;
  isLoading: boolean;
  rows: AiSuggestionRow[];
  /** Rendered instead of the list when not loading and there are no rows (Finance's generate button). */
  empty?: ReactNode;
  /** Rendered after the list inside the card (Finance's computed stats). */
  footer?: ReactNode;
}>) {
  return (
    <Card className="glass-card card-accent">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2.5">
          <IconTile className="w-7 h-7 rounded-md">
            <Sparkles className="w-3.5 h-3.5" />
          </IconTile>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        {isLoading ? (
          <div className="space-y-2">
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-full" />
          </div>
        ) : rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((row, i) => {
              const Row = row.onClick ? "button" : "div";
              return (
                <li key={i}>
                  <Row
                    type={row.onClick ? "button" : undefined}
                    onClick={row.onClick}
                    className={cn(
                      "w-full flex items-start gap-3 rounded-lg bg-secondary/20 px-3 py-2.5 text-start",
                      row.onClick && "cursor-pointer transition-colors hover:bg-secondary/40",
                    )}
                  >
                    <IconTile
                      tone={row.kind === "action" ? "analyze" : "study"}
                      className="w-7 h-7 rounded-lg shrink-0 mt-0.5"
                    >
                      {row.kind === "action" ? (
                        <ArrowRight className="w-3.5 h-3.5" />
                      ) : (
                        <Lightbulb className="w-3.5 h-3.5" />
                      )}
                    </IconTile>
                    <p className="text-xs leading-relaxed">{row.text}</p>
                  </Row>
                </li>
              );
            })}
          </ul>
        ) : (
          empty
        )}
        {footer}
      </CardContent>
    </Card>
  );
}
