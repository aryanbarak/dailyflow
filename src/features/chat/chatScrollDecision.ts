// SmartFlow -- Chat Experience v2 (task 17a). Pure, DOM-free scroll
// decision logic for the message list: a chat used for hours on end must
// never yank the reader's scroll position while they're reading history.
// New content only auto-follows the bottom when the reader was ALREADY at
// the bottom; otherwise a "jump to latest" affordance is offered instead
// of forcing the scroll. Kept pure (plain numbers in, boolean out) so the
// actual policy is unit-testable without a DOM/jsdom scroll container.

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

// A reader is "at the bottom" within this many pixels of true bottom --
// generous enough to absorb sub-pixel rounding and a bubble's own
// animation-in offset, tight enough that scrolling up even slightly to
// read an earlier message reliably disables auto-follow.
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** True when the scroll position is within threshold of the true bottom. */
export function isNearBottom(metrics: ScrollMetrics, thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom <= thresholdPx;
}

/**
 * Given the scroll metrics captured immediately BEFORE new content was
 * appended, decide whether to auto-scroll to follow it. Callers should
 * capture metrics right before the DOM update that adds new messages (not
 * after), since scrollHeight grows once the new content is in the DOM.
 */
export function shouldAutoScrollOnNewContent(
  metricsBeforeUpdate: ScrollMetrics,
  thresholdPx: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return isNearBottom(metricsBeforeUpdate, thresholdPx);
}
