// CORE audit item 1-3 -- the Daily home view's infinite-scroll-of-days
// mechanic. Pure, DOM-free prepend/append threshold decisions, mirroring
// src/features/chat/chatScrollDecision.ts's split (plain numbers in,
// boolean out, so the actual policy is unit-testable without a DOM/jsdom
// scroll container). Threshold matches CORE's own constant
// (components/daily/daily-page.client.tsx: SCROLL_THRESHOLD = 800).

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export const DAILY_SCROLL_THRESHOLD_PX = 800;

/** True when scrolled near the top edge -- older days should silently prepend. */
export function shouldPrependOlderDays(
  metrics: ScrollMetrics,
  thresholdPx: number = DAILY_SCROLL_THRESHOLD_PX,
): boolean {
  return metrics.scrollTop < thresholdPx;
}

/** True when scrolled near the bottom edge -- newer days should append. */
export function shouldAppendNewerDays(
  metrics: ScrollMetrics,
  thresholdPx: number = DAILY_SCROLL_THRESHOLD_PX,
): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom < thresholdPx;
}
