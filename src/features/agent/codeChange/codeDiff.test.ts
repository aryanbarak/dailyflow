import { describe, expect, it } from "vitest";
import { generateUnifiedDiff } from "./codeDiff";

describe("generateUnifiedDiff", () => {
  it("produces no hunks and isNoop=true for identical content", () => {
    const result = generateUnifiedDiff("line one\nline two\n", "line one\nline two\n", "file.txt");
    expect(result.isNoop).toBe(true);
    expect(result.hunks).toEqual([]);
    expect(result.text).toBe("");
    expect(result.addedLineCount).toBe(0);
    expect(result.removedLineCount).toBe(0);
  });

  it("detects a single changed line with correct hunk headers", () => {
    const base = "a\nb\nc\n";
    const proposed = "a\nB\nc\n";
    const result = generateUnifiedDiff(base, proposed, "file.txt");
    expect(result.isNoop).toBe(false);
    expect(result.addedLineCount).toBe(1);
    expect(result.removedLineCount).toBe(1);
    expect(result.hunks).toHaveLength(1);
    expect(result.text).toContain("--- a/file.txt");
    expect(result.text).toContain("+++ b/file.txt");
    expect(result.text).toContain("-b");
    expect(result.text).toContain("+B");
  });

  it("represents a pure insertion with a zero-length original side (zero context)", () => {
    const base = "a\nb\n";
    const proposed = "a\nb\nc\n";
    // contextLines=0 isolates the change itself -- with the default context
    // (3), the two preceding equal lines would be pulled in as context and
    // originalLines would legitimately be nonzero, which is covered by the
    // "merges nearby changes" test below.
    const result = generateUnifiedDiff(base, proposed, "file.txt", 0);
    expect(result.addedLineCount).toBe(1);
    expect(result.removedLineCount).toBe(0);
    const hunk = result.hunks[0];
    expect(hunk.originalLines).toBe(0);
    expect(hunk.lines.some((line) => line.type === "added" && line.content === "c")).toBe(true);
  });

  it("represents a pure deletion with a zero-length proposed side (zero context)", () => {
    const base = "a\nb\nc\n";
    const proposed = "a\nb\n";
    const result = generateUnifiedDiff(base, proposed, "file.txt", 0);
    expect(result.addedLineCount).toBe(0);
    expect(result.removedLineCount).toBe(1);
    const hunk = result.hunks[0];
    expect(hunk.proposedLines).toBe(0);
  });

  it("merges nearby changes into one hunk and separates distant ones", () => {
    const base = Array.from({ length: 30 }, (_, index) => `line-${index}`).join("\n") + "\n";
    const lines = base.split("\n");
    lines[1] = "CHANGED-1";
    lines[25] = "CHANGED-25";
    const proposed = lines.join("\n");
    const result = generateUnifiedDiff(base, proposed, "file.txt", 3);
    expect(result.hunks).toHaveLength(2);
  });

  it("is deterministic across repeated calls on the same input", () => {
    const base = "alpha\nbeta\ngamma\ndelta\n";
    const proposed = "alpha\nBETA\ngamma\nDELTA\n";
    const first = generateUnifiedDiff(base, proposed, "file.txt");
    const second = generateUnifiedDiff(base, proposed, "file.txt");
    expect(first).toEqual(second);
  });

  it("handles an empty base file (pure file creation content)", () => {
    const result = generateUnifiedDiff("", "new content\n", "new-file.txt");
    expect(result.isNoop).toBe(false);
    expect(result.removedLineCount).toBe(0);
    expect(result.addedLineCount).toBe(1);
  });

  it("handles a fully emptied proposed file", () => {
    const result = generateUnifiedDiff("only line\n", "", "file.txt");
    expect(result.addedLineCount).toBe(0);
    expect(result.removedLineCount).toBe(1);
  });

  it("isNoop is exact-string, not line-array, so a trailing-newline-only change is never misreported as identical", () => {
    // Known limitation: splitLines() discards the trailing-newline
    // distinction for hunk purposes (both become the single line "content"),
    // so no hunk is produced -- but isNoop compares the raw strings
    // directly, so it still correctly reports these as different content.
    const result = generateUnifiedDiff("content\n", "content", "file.txt");
    expect(result.isNoop).toBe(false);
    expect(result.hunks).toEqual([]);
  });
});
