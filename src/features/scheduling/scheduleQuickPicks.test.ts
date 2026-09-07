process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { RRule } from "rrule";
import { ONE_TIME_QUICK_PICKS, RECURRING_QUICK_PICKS } from "./scheduleQuickPicks";
import { nextOccurrenceAfter } from "./occurrences";

describe("ONE_TIME_QUICK_PICKS", () => {
  const now = new Date(2026, 8, 6, 14, 0, 0); // Sunday, Sep 6 2026, 14:00 -- an ordinary midweek instant

  it("resolves each chip to the expected instant", () => {
    const resolved = Object.fromEntries(ONE_TIME_QUICK_PICKS.map((pick) => [pick.id, pick.resolve(now).toISOString()]));
    expect(resolved).toEqual({
      in_1_hour: "2026-09-06T15:00:00.000Z",
      this_evening: "2026-09-06T23:59:59.999Z",
      tomorrow_morning: "2026-09-07T09:00:00.000Z",
      next_week: "2026-09-13T09:00:00.000Z",
    });
  });

  it("rolls over correctly across a month boundary (now = 23:58 on the last day of the month)", () => {
    const lateNow = new Date(2026, 8, 30, 23, 58, 0);
    const resolved = Object.fromEntries(ONE_TIME_QUICK_PICKS.map((pick) => [pick.id, pick.resolve(lateNow).toISOString()]));
    expect(resolved).toEqual({
      in_1_hour: "2026-10-01T00:58:00.000Z",
      this_evening: "2026-09-30T23:59:59.999Z",
      tomorrow_morning: "2026-10-01T09:00:00.000Z",
      next_week: "2026-10-07T09:00:00.000Z",
    });
  });
});

describe("RECURRING_QUICK_PICKS", () => {
  it("every hard-coded rrule string round-trips through the real rrule parser without throwing", () => {
    for (const pick of RECURRING_QUICK_PICKS) {
      expect(() => RRule.fromString(pick.rrule)).not.toThrow();
    }
  });

  it("'every Monday at 9am' from a Wednesday 'now' lands on the NEXT Monday, not today", () => {
    const wednesday = new Date(2026, 8, 9, 10, 0, 0); // Wed, Sep 9 2026
    const pick = RECURRING_QUICK_PICKS.find((p) => p.id === "every_monday_9am")!;
    const next = nextOccurrenceAfter(pick.rrule, wednesday, wednesday);
    expect(next?.toISOString()).toBe("2026-09-14T09:00:00.000Z");
  });

  it("'daily at 9am' from just past 9am today fires tomorrow, not later today", () => {
    const justAfterNine = new Date(2026, 8, 9, 9, 1, 0);
    const pick = RECURRING_QUICK_PICKS.find((p) => p.id === "daily_9am")!;
    const next = nextOccurrenceAfter(pick.rrule, justAfterNine, justAfterNine);
    expect(next?.toISOString()).toBe("2026-09-10T09:00:00.000Z");
  });
});
