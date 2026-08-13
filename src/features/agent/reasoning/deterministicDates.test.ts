import { describe, expect, it } from "vitest";
import { parseDeterministicDueDate } from "./deterministicDates";

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
