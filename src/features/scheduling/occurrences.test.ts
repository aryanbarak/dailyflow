// TZ pinned so wall-clock test expectations are deterministic regardless
// of the machine/CI running them -- occurrences.ts deliberately treats
// dates as wall-clock-only (see its own header comment), so tests must
// fix the one variable (the runtime's local zone) that would otherwise
// make "wall clock" ambiguous.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { fromRRuleDate, nextOccurrenceAfter, occurrencesInRange, toRRuleDate } from "./occurrences";

function iso(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString());
}

describe("toRRuleDate / fromRRuleDate", () => {
  it("round-trips a wall-clock date/time", () => {
    const original = new Date(2026, 8, 6, 9, 30, 0);
    const roundTripped = fromRRuleDate(toRRuleDate(original));
    expect(roundTripped.getTime()).toBe(original.getTime());
  });
});

describe("occurrencesInRange", () => {
  it("BYMONTHDAY=31 skips months with no 31st day (Jan -> Mar -> May, no Feb/Apr)", () => {
    const dtstart = new Date(2026, 0, 31, 9, 0, 0);
    const occurrences = occurrencesInRange("FREQ=MONTHLY;BYMONTHDAY=31", dtstart, dtstart, new Date(2026, 5, 30, 9, 0, 0));
    expect(iso(occurrences)).toEqual(["2026-01-31T09:00:00.000Z", "2026-03-31T09:00:00.000Z", "2026-05-31T09:00:00.000Z"]);
  });

  it("UNTIL is inclusive of an occurrence landing exactly on it", () => {
    const dtstart = new Date(2026, 8, 1, 9, 0, 0);
    const withUntilOnOccurrence = occurrencesInRange("FREQ=DAILY", dtstart, dtstart, new Date(2026, 8, 10, 9, 0, 0), new Date(2026, 8, 3, 9, 0, 0));
    expect(iso(withUntilOnOccurrence)).toEqual(["2026-09-01T09:00:00.000Z", "2026-09-02T09:00:00.000Z", "2026-09-03T09:00:00.000Z"]);
  });

  it("UNTIL one day before an occurrence excludes it", () => {
    const dtstart = new Date(2026, 8, 1, 9, 0, 0);
    const withUntilBeforeOccurrence = occurrencesInRange("FREQ=DAILY", dtstart, dtstart, new Date(2026, 8, 10, 9, 0, 0), new Date(2026, 8, 2, 9, 0, 0));
    expect(iso(withUntilBeforeOccurrence)).toEqual(["2026-09-01T09:00:00.000Z", "2026-09-02T09:00:00.000Z"]);
  });

  it("respects a COUNT-bounded rule", () => {
    const dtstart = new Date(2026, 8, 1, 9, 0, 0);
    const occurrences = occurrencesInRange("FREQ=DAILY;COUNT=3", dtstart, dtstart, new Date(2026, 8, 30, 9, 0, 0));
    expect(occurrences).toHaveLength(3);
  });

  it("range boundaries are inclusive on both ends", () => {
    const dtstart = new Date(2026, 8, 1, 9, 0, 0);
    const occurrences = occurrencesInRange("FREQ=DAILY", dtstart, new Date(2026, 8, 3, 9, 0, 0), new Date(2026, 8, 5, 9, 0, 0));
    expect(iso(occurrences)).toEqual(["2026-09-03T09:00:00.000Z", "2026-09-04T09:00:00.000Z", "2026-09-05T09:00:00.000Z"]);
  });

  it("handles a Feb 29 yearly rule (fires only on real leap years)", () => {
    const dtstart = new Date(2024, 1, 29, 9, 0, 0);
    const occurrences = occurrencesInRange("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", dtstart, dtstart, new Date(2033, 0, 1));
    expect(iso(occurrences)).toEqual(["2024-02-29T09:00:00.000Z", "2028-02-29T09:00:00.000Z", "2032-02-29T09:00:00.000Z"]);
  });

  it("a daily rule across a real-world DST-transition-dated window never skips or dupes a day (wall-clock hour stays fixed)", () => {
    const dtstart = new Date(2026, 2, 7, 9, 0, 0);
    const occurrences = occurrencesInRange("FREQ=DAILY", dtstart, dtstart, new Date(2026, 2, 10, 9, 0, 0));
    expect(occurrences).toHaveLength(4);
    expect(occurrences.every((d) => d.getUTCHours() === 9)).toBe(true);
  });

  it("throws (never silently returns []) on a malformed RRULE string", () => {
    const dtstart = new Date(2026, 8, 1, 9, 0, 0);
    expect(() => occurrencesInRange("not a real rule", dtstart, dtstart, new Date(2026, 8, 10))).toThrow();
  });
});

describe("nextOccurrenceAfter", () => {
  it("returns the next occurrence strictly after the given date", () => {
    const dtstart = new Date(2026, 8, 1, 9, 0, 0);
    const next = nextOccurrenceAfter("FREQ=WEEKLY;BYDAY=MO", dtstart, new Date(2026, 8, 6, 0, 0, 0));
    expect(next?.toISOString()).toBe("2026-09-07T09:00:00.000Z");
  });

  it("returns null once an exhausted (COUNT-bounded) rule has no more occurrences", () => {
    const dtstart = new Date(2026, 8, 1, 9, 0, 0);
    const next = nextOccurrenceAfter("FREQ=DAILY;COUNT=2", dtstart, new Date(2026, 8, 10, 0, 0, 0));
    expect(next).toBeNull();
  });
});
