// CORE-W5 (2026-09-06, CORE audit item ۱-۴): the ONE shared inline
// scheduling widget, replacing the old enum-based RecurrencePicker in
// both the Tasks and Calendar create/edit dialogs.
//
// Quick-pick chips (one-time and recurring) never touch the network --
// see scheduleQuickPicks.ts. Free text goes through /schedule/parse ONLY
// on an explicit confirm click (never per-keystroke, matching CORE's own
// schedule-dialog.tsx). Unlike CORE's dialog -- which has neither -- this
// shows a preview of the parsed result before the parent commits it and a
// real error message on a failed/unusable parse (this repo's established
// pattern, e.g. JournalCompanion.tsx's role="status" error line).
//
// This component does not own "when" state itself: it emits ONE
// normalized result and the parent decides how to apply it (Tasks slice
// `resolvedDateTime` to a date; Calendar uses the full ISO). The parent
// also owns the plain native date/time inputs -- editing those directly
// still works independently of this widget.
import { useState } from "react";
import { RRule } from "rrule";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { ONE_TIME_QUICK_PICKS, RECURRING_QUICK_PICKS } from "../scheduleQuickPicks";
import { parseScheduleText, scheduleErrorMessageKey, type ScheduleParseGranularity } from "../scheduleParseClient";

export interface SchedulePickerResult {
  recurrenceRule: string | null;
  recurrenceEndDate: string | null;
  resolvedDateTime: string | null;
}

interface SchedulePickerProps {
  readonly granularity: ScheduleParseGranularity;
  readonly recurrenceRule: string | null;
  readonly recurrenceEndDate?: string | null;
  onChange(result: SchedulePickerResult): void;
  parseText?: typeof parseScheduleText;
}

/** English-only fallback for an arbitrary persisted RRULE that isn't one of our own presets -- this repo deliberately does not build a full multilingual RRULE-to-text engine (documented scope boundary). */
function describeRule(rrule: string, t: ReturnType<typeof useT>["t"]): string {
  const known = RECURRING_QUICK_PICKS.find((pick) => pick.rrule === rrule);
  if (known) return t(known.labelKey);
  try {
    return new RRule(RRule.parseString(rrule)).toText();
  } catch {
    return rrule;
  }
}

export function SchedulePicker({ granularity, recurrenceRule, recurrenceEndDate = null, onChange, parseText = parseScheduleText }: SchedulePickerProps) {
  const { t, lang } = useT();
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClear = () => {
    setError(null);
    onChange({ recurrenceRule: null, recurrenceEndDate: null, resolvedDateTime: null });
  };

  const handleOneTimePick = (resolvedDateTime: Date) => {
    setError(null);
    onChange({ recurrenceRule: null, recurrenceEndDate: null, resolvedDateTime: resolvedDateTime.toISOString() });
  };

  const handleRecurringPick = (rrule: string) => {
    setError(null);
    onChange({ recurrenceRule: rrule, recurrenceEndDate, resolvedDateTime: null });
  };

  const handleParse = async () => {
    const trimmed = freeText.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await parseText(trimmed, granularity, lang);
      // The `in` guard (not `if (!result.ok)`) because this tsconfig has
      // strictNullChecks off, where negating a boolean discriminant does
      // not narrow a discriminated union (same gotcha documented in
      // JournalCompanion.tsx, verified against tsc 5.9).
      if ("code" in result) {
        const key = scheduleErrorMessageKey(result.code);
        setError(key ? t(key) : result.message);
        return;
      }
      if (result.kind === "none") {
        setError(t("schedule_error_no_schedule_detected"));
        return;
      }
      if (result.kind === "recurring" && result.rrule) {
        onChange({ recurrenceRule: result.rrule, recurrenceEndDate, resolvedDateTime: null });
      } else if (result.kind === "one_time" && result.startTime) {
        onChange({ recurrenceRule: null, recurrenceEndDate: null, resolvedDateTime: result.startTime });
      }
      setFreeText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label>{t("schedule_label")}</Label>

      {recurrenceRule && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-secondary/40 px-3 py-2 text-sm">
          <span className="truncate" dir="auto" data-testid="schedule-preview">{describeRule(recurrenceRule, t)}</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 gap-1" onClick={handleClear}>
            <X className="h-3.5 w-3.5" />
            {t("schedule_clear")}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {ONE_TIME_QUICK_PICKS.map((pick) => (
          <Button key={pick.id} type="button" variant="secondary" size="sm" onClick={() => handleOneTimePick(pick.resolve(new Date()))}>
            {t(pick.labelKey)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {RECURRING_QUICK_PICKS.map((pick) => (
          <Button
            key={pick.id}
            type="button"
            variant={recurrenceRule === pick.rrule ? "default" : "secondary"}
            size="sm"
            className={cn(recurrenceRule === pick.rrule && "border-primary")}
            onClick={() => handleRecurringPick(pick.rrule)}
          >
            {t(pick.labelKey)}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleParse();
            }
          }}
          placeholder={t("schedule_free_text_placeholder")}
          dir="auto"
          aria-label={t("schedule_label")}
        />
        <Button type="button" onClick={() => void handleParse()} disabled={busy || !freeText.trim()} className="shrink-0 gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("schedule_parse_confirm")}
        </Button>
      </div>
      {error && <p role="status" className="text-sm text-destructive">{error}</p>}

      {recurrenceRule && (
        <div className="space-y-1.5">
          <Label htmlFor="schedule-until">{t("schedule_until_label")}</Label>
          <input
            id="schedule-until"
            type="date"
            aria-label={t("schedule_until_label")}
            className="h-[var(--sf-control-h)] w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={recurrenceEndDate ?? ""}
            onChange={(e) => onChange({ recurrenceRule, recurrenceEndDate: e.target.value || null, resolvedDateTime: null })}
          />
        </div>
      )}
    </div>
  );
}
