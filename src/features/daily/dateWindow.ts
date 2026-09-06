// CORE audit item 1-3 -- pure date-array management for the Daily home
// view's infinite scroll. Kept DOM-free (arrays of Date in, arrays of
// Date out) so the window math is unit-testable without a scroll
// container, mirroring dailyScrollDecision.ts's split.
//
// Constants mirror CORE's own (components/daily/daily-page.client.tsx):
// 3 days pre-rendered after today, load 7 more per edge trigger, cap 30
// mounted days total.
import { addDays } from "date-fns";

export const INITIAL_AFTER_DAYS = 3;
export const LOAD_MORE_DAYS = 7;
export const MAX_MOUNTED_DAYS = 30;

/**
 * The date-key convention already baked into every journal_entries row:
 * JournalPage.tsx's todayStr() and JournalCalendar.tsx's toKey() both do
 * `date.toISOString().split('T')[0]` -- a UTC-slice, not the viewer's
 * local calendar day. Kept bit-identical on purpose: a day created here
 * must resolve to the exact row the single-day /journal page would read
 * for "the same" date. Fixing that pre-existing quirk is out of scope.
 */
export function dateKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** today + 0..initialAfter, inclusive -- e.g. today through 3 days ahead. */
export function buildInitialDates(today: Date, initialAfter: number = INITIAL_AFTER_DAYS): Date[] {
  return Array.from({ length: initialAfter + 1 }, (_, i) => addDays(today, i));
}

/**
 * `count` days immediately before the current oldest date, prepended in
 * chronological order, then trimmed from the NEWEST end so the window
 * never exceeds `max` -- the reader scrolled toward the past, so the
 * newest (already-seen) days are the ones to drop, not the ones just
 * added.
 */
export function prependDates(dates: readonly Date[], count: number = LOAD_MORE_DAYS, max: number = MAX_MOUNTED_DAYS): Date[] {
  const oldest = dates[0];
  const older = Array.from({ length: count }, (_, i) => addDays(oldest, -(count - i)));
  return [...older, ...dates].slice(0, max);
}

/**
 * `count` days immediately after the current newest date, appended in
 * chronological order, then trimmed from the OLDEST end so the window
 * never exceeds `max`.
 */
export function appendDates(dates: readonly Date[], count: number = LOAD_MORE_DAYS, max: number = MAX_MOUNTED_DAYS): Date[] {
  const newest = dates[dates.length - 1];
  const newer = Array.from({ length: count }, (_, i) => addDays(newest, i + 1));
  const next = [...dates, ...newer];
  return next.length > max ? next.slice(next.length - max) : next;
}
