// CORE-W5 (2026-09-06, CORE audit item ۱-۴): real RRULE occurrence math,
// wrapping the `rrule` npm package (the same library CORE itself uses).
//
// rrule.js reads and writes every date field through UTC getters/setters
// internally -- it has no real timezone/offset model at all. `toRRuleDate`/
// `fromRRuleDate` are the standard adapter pair for this: encode a real
// Date's LOCAL wall-clock fields into a Date whose UTC fields carry those
// same numbers (what rrule expects to receive), and the inverse for
// reading occurrences back out as normal local Dates. This app has no
// multi-timezone sharing of tasks/events (personal, single-user) -- this
// deliberately does NOT model real DST/offset conversion, only wall-clock
// arithmetic ("9am" always means wall-clock 9am, every day, regardless of
// DST). These two functions must be the ONLY place any Date crosses the
// rrule boundary -- mixing in a real-offset Date anywhere else would
// silently shift every computed occurrence by the browser's UTC offset,
// with no crash, just wrong output.
import { RRule } from "rrule";

export function toRRuleDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), 0),
  );
}

export function fromRRuleDate(date: Date): Date {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    0,
  );
}

/**
 * `rruleString` is the property list only (e.g. "FREQ=WEEKLY;BYDAY=MO"),
 * with no "RRULE:" prefix and no DTSTART line -- this app's stored format,
 * matching what schedule-parse-endpoint.ts returns. Throws (the `rrule`
 * library's own error) on a malformed string -- never silently degrades
 * to an empty rule.
 */
function buildRule(rruleString: string, dtstart: Date, until?: Date | null): RRule {
  const options = RRule.parseString(rruleString);
  return new RRule({
    ...options,
    dtstart: toRRuleDate(dtstart),
    until: until ? toRRuleDate(until) : (options.until ?? null),
  });
}

/** The next occurrence strictly after `after`, or `null` once the rule is exhausted. */
export function nextOccurrenceAfter(rruleString: string, dtstart: Date, after: Date, until?: Date | null): Date | null {
  const rule = buildRule(rruleString, dtstart, until);
  const next = rule.after(toRRuleDate(after), false);
  return next ? fromRRuleDate(next) : null;
}

/** All occurrences within [rangeStart, rangeEnd], inclusive of both ends. */
export function occurrencesInRange(rruleString: string, dtstart: Date, rangeStart: Date, rangeEnd: Date, until?: Date | null): Date[] {
  const rule = buildRule(rruleString, dtstart, until);
  return rule.between(toRRuleDate(rangeStart), toRRuleDate(rangeEnd), true).map(fromRRuleDate);
}
