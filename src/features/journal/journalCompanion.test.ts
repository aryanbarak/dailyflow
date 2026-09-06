// CORE-W3 (2026-09-06): line-based journal draft analysis.
import { describe, expect, it } from "vitest";
import { analyzeJournalDraft, JOURNAL_TASK_TITLE_MAX } from "./journalCompanion";

describe("analyzeJournalDraft", () => {
  it("detects the supported unchecked checkbox spellings with their line indexes", () => {
    const draft = ["روز خوبی بود", "- [ ] خرید شیر", "* [ ] call the doctor", "[ ] pay rent", "[] plan trip"].join("\n");
    const { checkboxes } = analyzeJournalDraft(draft);
    expect(checkboxes).toEqual([
      { lineIndex: 1, title: "خرید شیر" },
      { lineIndex: 2, title: "call the doctor" },
      { lineIndex: 3, title: "pay rent" },
      { lineIndex: 4, title: "plan trip" },
    ]);
  });

  it("ignores checked boxes, empty boxes, and checkbox-like prose", () => {
    const draft = ["- [x] done thing", "[ ]", "I wrote [ ] in the middle of a sentence? no: x [ ] y"].join("\n");
    expect(analyzeJournalDraft(draft).checkboxes).toEqual([]);
  });

  it("detects @ai instructions only at the start of a line, case-insensitively", () => {
    const draft = ["@ai خلاصه این هفته را بنویس", "  @AI translate this entry", "my email is x@ai.com"].join("\n");
    const { instructions } = analyzeJournalDraft(draft);
    expect(instructions).toEqual([
      { lineIndex: 0, instruction: "خلاصه این هفته را بنویس" },
      { lineIndex: 1, instruction: "translate this entry" },
    ]);
  });

  it("caps over-long checkbox titles with an ellipsis", () => {
    const long = "x".repeat(JOURNAL_TASK_TITLE_MAX + 30);
    const { checkboxes } = analyzeJournalDraft(`[ ] ${long}`);
    expect(checkboxes[0].title).toHaveLength(JOURNAL_TASK_TITLE_MAX);
    expect(checkboxes[0].title.endsWith("…")).toBe(true);
  });

  it("empty draft yields empty analysis", () => {
    expect(analyzeJournalDraft("")).toEqual({ checkboxes: [], instructions: [] });
  });
});
