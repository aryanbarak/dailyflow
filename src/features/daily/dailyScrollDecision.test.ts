import { describe, expect, it } from "vitest";
import { DAILY_SCROLL_THRESHOLD_PX, shouldAppendNewerDays, shouldPrependOlderDays } from "./dailyScrollDecision";

describe("shouldPrependOlderDays", () => {
  it("is true right at the top", () => {
    expect(shouldPrependOlderDays({ scrollTop: 0, scrollHeight: 5000, clientHeight: 800 })).toBe(true);
  });

  it("is true within the default threshold of the top", () => {
    expect(shouldPrependOlderDays({ scrollTop: DAILY_SCROLL_THRESHOLD_PX - 1, scrollHeight: 5000, clientHeight: 800 })).toBe(true);
  });

  it("is false past the default threshold", () => {
    expect(shouldPrependOlderDays({ scrollTop: DAILY_SCROLL_THRESHOLD_PX, scrollHeight: 5000, clientHeight: 800 })).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(shouldPrependOlderDays({ scrollTop: 50, scrollHeight: 5000, clientHeight: 800 }, 10)).toBe(false);
    expect(shouldPrependOlderDays({ scrollTop: 50, scrollHeight: 5000, clientHeight: 800 }, 60)).toBe(true);
  });
});

describe("shouldAppendNewerDays", () => {
  it("is true right at the bottom", () => {
    expect(shouldAppendNewerDays({ scrollTop: 4200, scrollHeight: 5000, clientHeight: 800 })).toBe(true);
  });

  it("is true within the default threshold of the bottom", () => {
    expect(shouldAppendNewerDays({ scrollTop: 4200 - (DAILY_SCROLL_THRESHOLD_PX - 1), scrollHeight: 5000, clientHeight: 800 })).toBe(true);
  });

  it("is false past the default threshold", () => {
    expect(shouldAppendNewerDays({ scrollTop: 4200 - DAILY_SCROLL_THRESHOLD_PX, scrollHeight: 5000, clientHeight: 800 })).toBe(false);
  });

  it("is true for a short window that doesn't fill the viewport (scrollHeight <= clientHeight)", () => {
    expect(shouldAppendNewerDays({ scrollTop: 0, scrollHeight: 400, clientHeight: 800 })).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(shouldAppendNewerDays({ scrollTop: 4150, scrollHeight: 5000, clientHeight: 800 }, 10)).toBe(false);
    expect(shouldAppendNewerDays({ scrollTop: 4150, scrollHeight: 5000, clientHeight: 800 }, 60)).toBe(true);
  });
});
