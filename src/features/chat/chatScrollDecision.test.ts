import { describe, expect, it } from "vitest";
import { isNearBottom, shouldAutoScrollOnNewContent, NEAR_BOTTOM_THRESHOLD_PX } from "./chatScrollDecision";

describe("isNearBottom", () => {
  it("is true when scrolled exactly to the bottom", () => {
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
  });

  it("is true within the default threshold of the bottom", () => {
    expect(isNearBottom({ scrollTop: 900 - NEAR_BOTTOM_THRESHOLD_PX, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
  });

  it("is false just past the default threshold", () => {
    expect(isNearBottom({ scrollTop: 900 - NEAR_BOTTOM_THRESHOLD_PX - 1, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });

  it("is false when scrolled up to read earlier history", () => {
    expect(isNearBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(isNearBottom({ scrollTop: 850, scrollHeight: 1000, clientHeight: 100 }, 10)).toBe(false);
    expect(isNearBottom({ scrollTop: 850, scrollHeight: 1000, clientHeight: 100 }, 60)).toBe(true);
  });

  it("is true for a short conversation that doesn't fill the viewport (scrollHeight <= clientHeight)", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 80, clientHeight: 400 })).toBe(true);
  });
});

describe("shouldAutoScrollOnNewContent", () => {
  it("auto-scrolls when the reader was at the bottom before new content arrived", () => {
    expect(shouldAutoScrollOnNewContent({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
  });

  it("does NOT auto-scroll (never yanks the position) when the reader had scrolled up into history", () => {
    expect(shouldAutoScrollOnNewContent({ scrollTop: 200, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });
});
