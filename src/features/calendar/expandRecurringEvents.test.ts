process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { expandRecurringEvents } from "./expandRecurringEvents";
import type { CalendarEvent } from "./calendarService";

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    title: "Team sync",
    dateTimeStart: "2026-09-07T09:00:00.000Z", // Monday
    dateTimeEnd: "2026-09-07T10:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("expandRecurringEvents", () => {
  it("passes a non-recurring event through unchanged", () => {
    const event = makeEvent();
    const result = expandRecurringEvents([event], new Date(2026, 8, 1), new Date(2026, 8, 30));
    expect(result).toEqual([event]);
  });

  it("expands a weekly recurring event onto every Monday in range, preserving the real id and duration", () => {
    const event = makeEvent({ recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" });
    const result = expandRecurringEvents([event], new Date(2026, 8, 1), new Date(2026, 8, 21, 23, 59, 59));
    expect(result.map((e) => e.dateTimeStart)).toEqual([
      "2026-09-07T09:00:00.000Z",
      "2026-09-14T09:00:00.000Z",
      "2026-09-21T09:00:00.000Z",
    ]);
    // Every occurrence keeps the REAL stored id -- editing any of them
    // resolves back to the one actual row.
    expect(result.every((e) => e.id === "evt-1")).toBe(true);
    // 1-hour duration preserved on every occurrence, not pinned to the
    // original literal end datetime.
    expect(result.map((e) => e.dateTimeEnd)).toEqual([
      "2026-09-07T10:00:00.000Z",
      "2026-09-14T10:00:00.000Z",
      "2026-09-21T10:00:00.000Z",
    ]);
  });

  it("respects recurrenceEndDate as the series' UNTIL boundary", () => {
    const event = makeEvent({
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
      recurrenceEndDate: "2026-09-14T09:00:00.000Z",
    });
    const result = expandRecurringEvents([event], new Date(2026, 8, 1), new Date(2026, 8, 30));
    expect(result.map((e) => e.dateTimeStart)).toEqual(["2026-09-07T09:00:00.000Z", "2026-09-14T09:00:00.000Z"]);
  });

  it("falls back to the literal stored event on a malformed rule, instead of dropping it", () => {
    const event = makeEvent({ recurrenceRule: "not a real rule" });
    const result = expandRecurringEvents([event], new Date(2026, 8, 1), new Date(2026, 8, 30));
    expect(result).toEqual([event]);
  });

  it("mixes recurring and non-recurring events in the same list", () => {
    const recurring = makeEvent({ id: "evt-recurring", recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" });
    const plain = makeEvent({ id: "evt-plain", dateTimeStart: "2026-09-10T12:00:00.000Z", dateTimeEnd: "2026-09-10T13:00:00.000Z" });
    const result = expandRecurringEvents([recurring, plain], new Date(2026, 8, 1), new Date(2026, 8, 14, 23, 59, 59));
    expect(result.map((e) => e.id)).toEqual(["evt-recurring", "evt-recurring", "evt-plain"]);
  });
});
