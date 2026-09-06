import { describe, expect, it } from "vitest";
import {
  appendDates,
  buildInitialDates,
  dateKey,
  INITIAL_AFTER_DAYS,
  LOAD_MORE_DAYS,
  MAX_MOUNTED_DAYS,
  prependDates,
} from "./dateWindow";

describe("dateKey", () => {
  it("matches the UTC-slice convention already used elsewhere in the journal feature", () => {
    expect(dateKey(new Date("2026-09-06T12:00:00.000Z"))).toBe("2026-09-06");
    expect(dateKey(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });
});

describe("buildInitialDates", () => {
  it("returns today plus the default number of days ahead, inclusive", () => {
    const today = new Date("2026-09-06T10:00:00.000Z");
    const dates = buildInitialDates(today);
    expect(dates).toHaveLength(INITIAL_AFTER_DAYS + 1);
    expect(dates.map(dateKey)).toEqual(["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"]);
  });

  it("respects a custom initialAfter", () => {
    const today = new Date("2026-09-06T10:00:00.000Z");
    expect(buildInitialDates(today, 1).map(dateKey)).toEqual(["2026-09-06", "2026-09-07"]);
  });
});

describe("prependDates", () => {
  it("adds LOAD_MORE_DAYS immediately before the current oldest date, in chronological order", () => {
    const dates = buildInitialDates(new Date("2026-09-06T10:00:00.000Z"), 0); // just today
    const next = prependDates(dates);
    expect(next).toHaveLength(1 + LOAD_MORE_DAYS);
    expect(next.map(dateKey)).toEqual([
      "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02",
      "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06",
    ]);
  });

  it("trims from the NEWEST end once the cap is exceeded (the reader scrolled toward the past)", () => {
    // 25 consecutive days ending 2026-09-06; prepending 7 more would be 32, over the cap of 30.
    const start = new Date("2026-08-13T10:00:00.000Z");
    const dates = Array.from({ length: 25 }, (_, i) => new Date(start.getTime() + i * 86_400_000));
    const next = prependDates(dates, LOAD_MORE_DAYS, MAX_MOUNTED_DAYS);
    expect(next).toHaveLength(MAX_MOUNTED_DAYS);
    // Oldest is the new prepended day; newest 2 days (09-05, 09-06) got trimmed off the end.
    expect(dateKey(next[0])).toBe("2026-08-06");
    expect(dateKey(next[next.length - 1])).toBe("2026-09-04");
  });

  it("respects a custom count", () => {
    const dates = buildInitialDates(new Date("2026-09-06T10:00:00.000Z"), 0);
    expect(prependDates(dates, 2).map(dateKey)).toEqual(["2026-09-04", "2026-09-05", "2026-09-06"]);
  });
});

describe("appendDates", () => {
  it("adds LOAD_MORE_DAYS immediately after the current newest date, in chronological order", () => {
    const dates = buildInitialDates(new Date("2026-09-06T10:00:00.000Z"), 0); // just today
    const next = appendDates(dates);
    expect(next).toHaveLength(1 + LOAD_MORE_DAYS);
    expect(next.map(dateKey)).toEqual([
      "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
      "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13",
    ]);
  });

  it("trims from the OLDEST end once the cap is exceeded", () => {
    const start = new Date("2026-08-13T10:00:00.000Z");
    const dates = Array.from({ length: 25 }, (_, i) => new Date(start.getTime() + i * 86_400_000));
    const next = appendDates(dates, LOAD_MORE_DAYS, MAX_MOUNTED_DAYS);
    expect(next).toHaveLength(MAX_MOUNTED_DAYS);
    // Newest is the new appended day; oldest 2 days got trimmed off the front.
    expect(dateKey(next[next.length - 1])).toBe("2026-09-13");
    expect(dateKey(next[0])).toBe("2026-08-15");
  });

  it("respects a custom count", () => {
    const dates = buildInitialDates(new Date("2026-09-06T10:00:00.000Z"), 0);
    expect(appendDates(dates, 2).map(dateKey)).toEqual(["2026-09-06", "2026-09-07", "2026-09-08"]);
  });
});
