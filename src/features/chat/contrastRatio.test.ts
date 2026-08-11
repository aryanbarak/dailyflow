import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance, WCAG_AA_NORMAL_TEXT_MIN_RATIO } from "./contrastRatio";

describe("contrastRatio (WCAG relative-luminance method)", () => {
  it("black vs. white is the maximum possible ratio, 21:1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("a color against itself is always 1:1", () => {
    expect(contrastRatio("#7C4DFF", "#7C4DFF")).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of argument order", () => {
    expect(contrastRatio("#0F1128", "#F7F7FC")).toBeCloseTo(contrastRatio("#F7F7FC", "#0F1128"), 5);
  });

  it("relativeLuminance(white) is 1 and relativeLuminance(black) is 0", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });
});

// Task 17b, Dark Cosmic bubble pairs -- the two the PO's own task explicitly
// asked to be checked and reported. Values are the derived-token colors
// actually shipped in index.css's [data-chat-theme="dark"] block (see that
// file's comments for exactly which --flow-* token each hex comes from).
describe("Dark Cosmic bubble contrast (task 17b, section E of the report)", () => {
  it("assistant bubble: --flow-surface-2 background vs. --flow-text-primary passes AA comfortably", () => {
    const ratio = contrastRatio("#0F1128", "#F7F7FC");
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT_MIN_RATIO);
    expect(ratio).toBeCloseTo(17.4, 0);
  });

  it("PO-flagged risk: --flow-gradient-primary's lightest stop (#A45EFF) vs. --flow-text-primary FAILS AA for normal text", () => {
    // This is exactly the pair the PO's clarification called out as "most
    // likely to land under AA" -- confirmed here, which is why the user
    // bubble does NOT render text directly on the raw 3-stop gradient (see
    // index.css: --chat-bubble-user derives from --flow-primary-600
    // instead, the PO's own suggested adjustment, not an invented color).
    const ratio = contrastRatio("#A45EFF", "#F7F7FC");
    expect(ratio).toBeLessThan(WCAG_AA_NORMAL_TEXT_MIN_RATIO);
    expect(ratio).toBeCloseTo(3.49, 1);
  });

  it("user bubble (AA-adjusted): --flow-primary-600 solid vs. --flow-text-primary passes AA", () => {
    const ratio = contrastRatio("#6938F0", "#F7F7FC");
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT_MIN_RATIO);
    expect(ratio).toBeCloseTo(5.74, 1);
  });
});
