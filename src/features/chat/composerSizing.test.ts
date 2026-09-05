import { describe, expect, it, vi } from "vitest";
import {
  clampComposerHeight,
  isComposerOverflowing,
  prefersDesktopEnterToSend,
  COMPOSER_MIN_LINES,
  COMPOSER_MAX_LINES,
} from "./composerSizing";

const LINE_HEIGHT = 20;
const PADDING = 16;

describe("clampComposerHeight", () => {
  // PO decision (2026-09-05, ChatGPT-style compact pass): back to a 1-line
  // minimum (task 17c D1 had raised it to 2; the PO judged the resting
  // composer too tall against the ChatGPT reference) -- locked in
  // explicitly so an accidental change is caught here, not just via the
  // "never below minimum" test below (which passes for ANY minimum, since
  // it reads COMPOSER_MIN_LINES symbolically).
  it("the configured minimum is 1 line (PO 2026-09-05 compact pass -- was 2 under 17c D1)", () => {
    expect(COMPOSER_MIN_LINES).toBe(1);
  });

  it("grows to the natural content height between the minimum and 5 lines", () => {
    const threeLines = LINE_HEIGHT * 3 + PADDING;
    expect(clampComposerHeight(threeLines, LINE_HEIGHT, PADDING)).toBe(threeLines);
  });

  it("never goes below the configured line minimum, even for empty/near-empty content", () => {
    const minHeight = LINE_HEIGHT * COMPOSER_MIN_LINES + PADDING;
    expect(clampComposerHeight(5, LINE_HEIGHT, PADDING)).toBe(minHeight);
  });

  it("caps at the 5-line maximum -- internal scroll takes over beyond this, never grows the field further", () => {
    const maxHeight = LINE_HEIGHT * COMPOSER_MAX_LINES + PADDING;
    const requestedTenLines = LINE_HEIGHT * 10 + PADDING;
    expect(clampComposerHeight(requestedTenLines, LINE_HEIGHT, PADDING)).toBe(maxHeight);
  });

  it("returns the raw scrollHeight unchanged when line height is unknown/zero (defensive fallback)", () => {
    expect(clampComposerHeight(123, 0)).toBe(123);
  });

  it("defaults verticalPaddingPx to 0 when omitted", () => {
    // Task 17c, D1: the requested height here must clear the NEW 2-line
    // minimum (was 1 line under 17a) on its own, otherwise this would be
    // testing the min-height clamp instead of the padding default -- a
    // single line height (the old test's value) now always gets clamped
    // up to the 2-line floor regardless of padding, which would make this
    // assertion pass for the wrong reason.
    const threeLines = LINE_HEIGHT * 3;
    expect(clampComposerHeight(threeLines, LINE_HEIGHT)).toBe(threeLines);
  });
});

describe("isComposerOverflowing", () => {
  it("is false at or under the 5-line cap", () => {
    const maxHeight = LINE_HEIGHT * COMPOSER_MAX_LINES + PADDING;
    expect(isComposerOverflowing(maxHeight, LINE_HEIGHT, PADDING)).toBe(false);
    expect(isComposerOverflowing(maxHeight - 1, LINE_HEIGHT, PADDING)).toBe(false);
  });

  it("is true just past the 5-line cap", () => {
    const maxHeight = LINE_HEIGHT * COMPOSER_MAX_LINES + PADDING;
    expect(isComposerOverflowing(maxHeight + 1, LINE_HEIGHT, PADDING)).toBe(true);
  });

  it("is false when line height is unknown/zero (defensive fallback)", () => {
    expect(isComposerOverflowing(99999, 0)).toBe(false);
  });
});

describe("prefersDesktopEnterToSend", () => {
  it("is true when the platform reports a fine (mouse-like) pointer -- Enter sends, Shift+Enter is a newline", () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === "(pointer: fine)" }));
    expect(prefersDesktopEnterToSend(matchMedia)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(pointer: fine)");
  });

  it("is false on a coarse (touch) pointer -- mobile keyboards/IME get Enter as ordinary newline input", () => {
    const matchMedia = vi.fn((_query: string) => ({ matches: false }));
    expect(prefersDesktopEnterToSend(matchMedia)).toBe(false);
  });

  it("is false when matchMedia is unavailable (defensive fallback, e.g. an unusual embedded webview)", () => {
    expect(prefersDesktopEnterToSend(undefined)).toBe(false);
  });
});
