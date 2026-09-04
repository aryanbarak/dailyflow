import { describe, expect, it } from "vitest";
import { parseDeterministicDueDate, parseDeterministicTimeOfDay, parseDeterministicTimeRange } from "./deterministicDates";

const NOW = new Date("2026-08-13T18:06:00.000Z");
const TZ = "Europe/Berlin";

describe("parseDeterministicDueDate", () => {
  it.each([
    ["create a task for today", "2026-08-13"],
    ["create a task for tomorrow", "2026-08-14"],
    ["create a task in 3 days", "2026-08-16"],
    ["create a task for Friday", "2026-08-14"],
    ["create a task for 2026-09-01", "2026-09-01"],
    ["erstelle eine Aufgabe fuer heute", "2026-08-13"],
    ["erstelle eine Aufgabe fuer morgen", "2026-08-14"],
    ["erstelle eine Aufgabe in 4 Tagen", "2026-08-17"],
    ["erstelle eine Aufgabe fuer Freitag", "2026-08-14"],
    ["erstelle eine Aufgabe fuer 2026.09.02", "2026-09-02"],
    ["\u06cc\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u0627\u0645\u0631\u0648\u0632 \u0628\u0633\u0627\u0632", "2026-08-13"],
    ["\u06cc\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u0641\u0631\u062f\u0627 \u0628\u0633\u0627\u0632", "2026-08-14"],
    ["\u06cc\u06a9 \u062a\u0633\u06a9 \u062f\u0631 \u06f5 \u0631\u0648\u0632 \u0628\u0633\u0627\u0632", "2026-08-18"],
    ["\u06cc\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u062c\u0645\u0639\u0647 \u0628\u0633\u0627\u0632", "2026-08-14"],
    ["\u06cc\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u06f2\u06f0\u06f2\u06f6-\u06f0\u06f9-\u06f0\u06f1 \u0628\u0633\u0627\u0632", "2026-09-01"],
  ])("resolves %s", (message, expected) => {
    expect(parseDeterministicDueDate(message, NOW, TZ)).toEqual({
      value: expected,
      clarificationNeeded: false,
    });
  });

  it("asks for clarification when a due-date cue is present but unparseable", () => {
    expect(parseDeterministicDueDate("create a task due sometime soon", NOW, TZ)).toEqual({
      clarificationNeeded: true,
    });
  });
});

// TIME-01 (production, 2026-09): «ساعتش را بکن ۵ عصر» -- the possessive
// «ساعتش» means «ساعت» never stands alone before the digit, so the
// anchored Persian pattern missed the whole message; the calendar update
// then died as a silently suppressed ask_clarification (start/end wiped,
// no update field left). The parser now also accepts a bare
// "hour + REQUIRED meridiem" -- the mandatory suffix is what keeps a bare
// number from ever matching. Hand-synced twin of the same tests in
// agent/worker/flow-write-policy.test.ts.
describe("parseDeterministicTimeOfDay: bare hour + required meridiem (TIME-01)", () => {
  it.each([
    ["ساعتش را بکن ۵ عصر", "17:00"],
    ["۵ عصر", "17:00"],
    ["۵:۳۰ عصر", "17:30"],
    ["۱۱ صبح", "11:00"],
    ["۸ شب", "20:00"],
    ["make it 5 pm", "17:00"],
    ["move it to 5pm", "17:00"],
    ["5:30 pm", "17:30"],
    ["mach es auf 17 uhr", "17:00"],
  ])("parses %s as %s", (phrase, expected) => {
    expect(parseDeterministicTimeOfDay(phrase)).toBe(expected);
  });

  it.each([
    ["ساعتش را عوض کن"],
    ["۵"],
    ["فردا"],
    ["make it 5"],
  ])("a bare number or no time at all still parses nothing: %s", (phrase) => {
    expect(parseDeterministicTimeOfDay(phrase)).toBeUndefined();
  });

  it("the (?<![0-9:]) guard keeps the tail of a larger number from being read as an hour", () => {
    expect(parseDeterministicTimeOfDay("۲۵ عصر")).toBeUndefined();
  });

  it("a German range keeps its FIRST time as the start even though only the last carries 'Uhr' -- earliest match wins between suffixed and compact", () => {
    expect(parseDeterministicTimeRange("von 13:00 bis 15:00 Uhr")).toEqual({ start: "13:00", end: "15:00" });
  });

  it("on an exact tie the suffixed reading beats compact so the meridiem is honored", () => {
    expect(parseDeterministicTimeOfDay("5:30 pm")).toBe("17:30");
  });

  it("anchored forms keep their existing precedence and results", () => {
    expect(parseDeterministicTimeOfDay("ساعت ۵ عصر")).toBe("17:00");
    expect(parseDeterministicTimeOfDay("at 11am")).toBe("11:00");
    expect(parseDeterministicTimeOfDay("um 7:05 uhr")).toBe("07:05");
    expect(parseDeterministicTimeOfDay("at 14:00")).toBe("14:00");
  });
});
