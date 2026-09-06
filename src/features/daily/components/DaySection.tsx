// CORE audit item 1-3 -- one calendar day inside the Daily home view's
// infinite scroll. Reuses the existing single-day journal editor and its
// companion (checkbox -> task, @ai with the idle watcher) VERBATIM --
// exactly as src/pages/JournalPage.tsx already wires them for one day --
// so every day in this scroll gets that behavior for free, with zero
// duplicated logic.
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import type { Task } from "@/features/tasks/tasksService";
import { JournalEditor } from "@/features/journal/components/JournalEditor";
import { JournalCompanion } from "@/features/journal/components/JournalCompanion";
import { dateKey } from "../dateWindow";

// Mirrors src/pages/JournalPage.tsx's LOCALE_MAP -- the same
// duplicated-per-file convention already used for date formatting
// elsewhere in the journal feature (JournalPage's todayStr(),
// JournalCalendar's toKey()).
const LOCALE_MAP = { en: "en-US", de: "de-DE", fa: "fa-IR" } as const;

interface DaySectionProps {
  readonly date: Date;
  /** A single shared "now" from the parent, so every section's today-check compares against the same instant. */
  readonly today: Date;
  readonly userId: string;
  readonly tasks: readonly Pick<Task, "title" | "completed">[];
  onCreateTask(payload: { title: string; notes: string }): Promise<unknown>;
}

export function DaySection({ date, today, userId, tasks, onCreateTask }: DaySectionProps) {
  const { lang } = useT();
  // The watcher's own localStorage flag (sf-journal-watcher-v1, set in
  // JournalCompanion) is read once per mount -- toggling it in one visible
  // day won't live-update the other mounted days until THEY remount. Same
  // per-instance shape CORE's own scanner has; not a bug at this scale.
  const [draftContent, setDraftContent] = useState("");
  const key = dateKey(date);
  const isToday = key === dateKey(today);

  const label = date.toLocaleDateString(LOCALE_MAP[lang], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <Card className={cn("glass-card", isToday && "border-primary")} data-testid={`day-section-${key}`}>
      <CardHeader className="sticky top-0 z-10 flex flex-row items-center bg-card/95 backdrop-blur">
        <CardTitle className={cn("flex items-center gap-2 text-base", isToday ? "text-foreground" : "text-muted-foreground")}>
          {label}
          {isToday && <span className="text-primary" aria-hidden="true">•</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <JournalEditor date={key} onContentChange={setDraftContent} />
        <JournalCompanion userId={userId} date={key} content={draftContent} tasks={tasks} onCreateTask={onCreateTask} />
      </CardContent>
    </Card>
  );
}
