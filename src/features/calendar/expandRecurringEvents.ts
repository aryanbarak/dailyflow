// CORE-W5 (2026-09-06, CORE audit item 1-4): calendar events get FULL
// occurrence expansion (unlike Tasks, which only get a read-only "next
// occurrence" indicator -- see TasksPage.tsx's repeatsLabel for why).
// Recurrence for a calendar event is unambiguous: it either happens on a
// day or it doesn't, so every occurrence within the visible range is
// rendered, not just the literal stored row.
import type { CalendarEvent } from "./calendarService";
import { occurrencesInRange } from "@/features/scheduling/occurrences";

/**
 * Non-recurring events pass through unchanged. A recurring event is
 * replaced by one copy per occurrence within [rangeStart, rangeEnd] --
 * every copy keeps the event's REAL id (never a synthetic one), so
 * opening any occurrence for edit/delete always resolves to the one
 * actual stored row. Duration is preserved: an occurrence's end time
 * shifts by the same delta as its start, rather than staying pinned to
 * the original occurrence's literal end datetime.
 */
export function expandRecurringEvents(
  events: readonly CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const expanded: CalendarEvent[] = [];
  for (const event of events) {
    if (!event.recurrenceRule) {
      expanded.push(event);
      continue;
    }
    const dtstart = new Date(event.dateTimeStart);
    const durationMs = event.dateTimeEnd ? new Date(event.dateTimeEnd).getTime() - dtstart.getTime() : null;
    const until = event.recurrenceEndDate ? new Date(event.recurrenceEndDate) : null;

    let occurrences: Date[];
    try {
      occurrences = occurrencesInRange(event.recurrenceRule, dtstart, rangeStart, rangeEnd, until);
    } catch {
      // A legacy/malformed stored rule -- fall back to the literal date
      // rather than dropping the event entirely.
      expanded.push(event);
      continue;
    }

    for (const occurrence of occurrences) {
      expanded.push({
        ...event,
        dateTimeStart: occurrence.toISOString(),
        dateTimeEnd: durationMs !== null ? new Date(occurrence.getTime() + durationMs).toISOString() : event.dateTimeEnd,
      });
    }
  }
  return expanded;
}
