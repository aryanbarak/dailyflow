// CORE-W5 (2026-09-06, CORE audit item ۱-۴): quick-pick chips. Pure,
// DOM-free (mirrors chatScrollDecision.ts's split) -- NEITHER list ever
// calls an LLM.
//
// One-time chips resolve a concrete datetime from `now` via date-fns
// (CORE's own approach for its equivalent presets). Recurring chips carry
// a HARD-CODED, deterministic RRULE string -- a deliberate deviation from
// CORE, whose five recurring presets round-trip through the LLM even
// though their text is fixed. Since these are OUR OWN preset labels, their
// RRULE is already known; sending our own literal string to an LLM to
// reparse it would be pure round-trip waste. Free text (anything not
// matching one of these) is the only input that ever reaches
// /schedule/parse.
//
// Same chip set is offered for both granularities (date-only tasks and
// full datetime calendar events) -- a pragmatic v1 simplification: for a
// date-only task, "in 1 hour" and "this evening" both reduce to "today"
// once the caller strips the time component, which is redundant but never
// wrong. Splitting the chip set per granularity is a straightforward
// follow-up if that redundancy turns out to bother users in practice.
import { addDays, addHours, addWeeks, endOfDay } from "date-fns";
import type { TranslationKey } from "@/i18n";

export interface OneTimeQuickPick {
  readonly id: string;
  readonly labelKey: TranslationKey;
  resolve(now: Date): Date;
}

export interface RecurringQuickPick {
  readonly id: string;
  readonly labelKey: TranslationKey;
  /** Property list only -- no "RRULE:" prefix, no DTSTART (this app's stored format). */
  readonly rrule: string;
}

function atHour(date: Date, hour: number): Date {
  const next = new Date(date);
  next.setHours(hour, 0, 0, 0);
  return next;
}

export const ONE_TIME_QUICK_PICKS: readonly OneTimeQuickPick[] = [
  { id: "in_1_hour", labelKey: "schedule_chip_in_1_hour", resolve: (now) => addHours(now, 1) },
  { id: "this_evening", labelKey: "schedule_chip_this_evening", resolve: (now) => endOfDay(now) },
  { id: "tomorrow_morning", labelKey: "schedule_chip_tomorrow_morning", resolve: (now) => atHour(addDays(now, 1), 9) },
  { id: "next_week", labelKey: "schedule_chip_next_week", resolve: (now) => atHour(addWeeks(now, 1), 9) },
];

export const RECURRING_QUICK_PICKS: readonly RecurringQuickPick[] = [
  { id: "daily_9am", labelKey: "schedule_chip_daily_9am", rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0" },
  { id: "weekdays_9am", labelKey: "schedule_chip_weekdays_9am", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0" },
  { id: "every_monday_9am", labelKey: "schedule_chip_every_monday_9am", rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" },
  { id: "monthly_1st_9am", labelKey: "schedule_chip_monthly_1st_9am", rrule: "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0" },
];
