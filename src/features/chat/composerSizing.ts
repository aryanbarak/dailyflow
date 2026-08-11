// SmartFlow -- Chat Experience v2 (task 17a; base height revised in task
// 17c, PO decision D1). Pure auto-grow math for the composer textarea: a
// 2-line minimum (D1 -- was 1 line under 17a), ~5 lines maximum (17a's
// original cap, unchanged), then internal scroll takes over. Kept separate
// from the DOM-measurement code (which lives in ChatComposer.tsx, reading
// textarea.scrollHeight via a ref) so the clamping policy itself is
// unit-testable with plain numbers.

export const COMPOSER_MIN_LINES = 2;
export const COMPOSER_MAX_LINES = 5;

/**
 * Clamps a textarea's natural content height (scrollHeight) to the
 * composer's 1..5 line range. `singleLineHeightPx` is the browser's own
 * computed line-height for the field (varies by font/zoom, so callers
 * measure it rather than assume a constant); `verticalPaddingPx` is the
 * field's own top+bottom padding, included on both bounds since
 * scrollHeight itself includes padding.
 */
export function clampComposerHeight(
  scrollHeightPx: number,
  singleLineHeightPx: number,
  verticalPaddingPx = 0,
): number {
  if (!(singleLineHeightPx > 0)) return scrollHeightPx;
  const minHeight = singleLineHeightPx * COMPOSER_MIN_LINES + verticalPaddingPx;
  const maxHeight = singleLineHeightPx * COMPOSER_MAX_LINES + verticalPaddingPx;
  return Math.min(Math.max(scrollHeightPx, minHeight), maxHeight);
}

/** True once content would need more than COMPOSER_MAX_LINES -- the field should switch to internal scroll rather than keep growing. */
export function isComposerOverflowing(
  scrollHeightPx: number,
  singleLineHeightPx: number,
  verticalPaddingPx = 0,
): boolean {
  if (!(singleLineHeightPx > 0)) return false;
  const maxHeight = singleLineHeightPx * COMPOSER_MAX_LINES + verticalPaddingPx;
  return scrollHeightPx > maxHeight;
}

/**
 * Task 17a: on every device EXCEPT one with a real keyboard, Enter should
 * behave like ordinary text input (newline / IME confirmation), not send
 * -- mobile virtual keyboards and IME composition make an unconditional
 * Enter-to-send behavior unreliable and surprising. `(pointer: fine)` is
 * the correct signal (a precise pointing device implies a real keyboard is
 * also present), not a viewport-width breakpoint -- a narrow desktop
 * browser window must still send on Enter, and a large-screen touch
 * tablet must not.
 */
export function prefersDesktopEnterToSend(matchMedia?: (query: string) => { matches: boolean } | undefined): boolean {
  if (!matchMedia) return false;
  const result = matchMedia("(pointer: fine)");
  return result?.matches ?? false;
}
