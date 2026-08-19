import { expect, test } from '@playwright/test';

// MB-03-FIX: production regression -- PO reported pull-to-refresh no longer
// worked ANYWHERE in the app after MB-03 shipped. Root cause: the dialog
// root's touch-action/overscroll-behavior guards were applied for the WHOLE
// 'active' | 'exiting' | 'error' lifespan of the overlay, and the only path
// back out of 'exiting' was the handoff animation's onAnimationComplete
// callback -- if that never fires (backgrounded tab mid-animation, a
// framer-motion edge case), the dialog stays mounted with its full-viewport
// gesture guard blocking touch/scroll indefinitely. Fix: guards now scoped
// to 'active' only, plus a fail-safe timeout that force-closes if the exit
// animation never resolves (see MicroBreakOverlay.tsx and
// MicroBreakOverlayExitFailsafe.test.tsx for the unit-level proof of the
// timeout itself -- this suite proves the DOM never carries the leaked
// guard, across all three exit paths, in a real browser).

const HARNESS_URL = '/__dev/micro-breaks-harness';
const START_BUTTON = '[data-testid="mb-harness-start"]';

async function readGuardStyles(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      htmlTouchAction: html.touchAction,
      htmlOverscrollBehaviorY: html.overscrollBehaviorY,
      bodyTouchAction: body.touchAction,
      bodyOverscrollBehaviorY: body.overscrollBehaviorY,
      bodyOverflowInlineStyle: document.body.style.overflow,
      dialogPresent: !!document.querySelector('[role="dialog"]'),
    };
  });
}

test.describe('Micro Breaks gesture-guard scope (MB-03-FIX)', () => {
  test('before ever opening Micro Breaks, no gesture guard is present', async ({ page }) => {
    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    const styles = await readGuardStyles(page);
    expect(styles.htmlTouchAction).toBe('auto');
    expect(styles.htmlOverscrollBehaviorY).toBe('auto');
    expect(styles.bodyTouchAction).toBe('auto');
    expect(styles.bodyOverscrollBehaviorY).toBe('auto');
    expect(styles.bodyOverflowInlineStyle).toBe('');
    expect(styles.dialogPresent).toBe(false);
  });

  test('close button path: guard is present while playing, fully gone afterward', async ({ page }) => {
    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);
    // ADR-0015 § 8: the overlay now shows a session-type choice screen
    // before either game starts -- pick "Quick Break" to reach the exact
    // same game-active state these Quick-Break-focused specs always
    // exercised before this slice.
    await page.getByRole('button', { name: 'Quick Break' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCSS('overscroll-behavior-y', 'contain');
    await expect(dialog).toHaveCSS('touch-action', 'none');

    await page.getByRole('button', { name: 'Close micro break' }).click();
    await expect(dialog).not.toBeVisible();

    const after = await readGuardStyles(page);
    expect(after.htmlTouchAction).toBe('auto');
    expect(after.htmlOverscrollBehaviorY).toBe('auto');
    expect(after.bodyTouchAction).toBe('auto');
    expect(after.bodyOverscrollBehaviorY).toBe('auto');
    expect(after.bodyOverflowInlineStyle).toBe('');
    expect(after.dialogPresent).toBe(false);
  });

  test('Esc path: guard is present while playing, fully gone afterward', async ({ page }) => {
    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);
    // ADR-0015 § 8: the overlay now shows a session-type choice screen
    // before either game starts -- pick "Quick Break" to reach the exact
    // same game-active state these Quick-Break-focused specs always
    // exercised before this slice.
    await page.getByRole('button', { name: 'Quick Break' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCSS('overscroll-behavior-y', 'contain');
    await expect(dialog).toHaveCSS('touch-action', 'none');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    const after = await readGuardStyles(page);
    expect(after.htmlTouchAction).toBe('auto');
    expect(after.htmlOverscrollBehaviorY).toBe('auto');
    expect(after.bodyTouchAction).toBe('auto');
    expect(after.bodyOverscrollBehaviorY).toBe('auto');
    expect(after.bodyOverflowInlineStyle).toBe('');
    expect(after.dialogPresent).toBe(false);
  });

  test('crash (MB-02b error phase) path: no gesture guard survives, even though PongCanvas itself failed', async ({ page }) => {
    await page.addInitScript(() => {
      const original = CanvasGradient.prototype.addColorStop;
      let thrown = false;
      CanvasGradient.prototype.addColorStop = function (...args: Parameters<typeof original>) {
        if (!thrown) {
          thrown = true;
          throw new Error('MB-03-FIX test-injected draw failure');
        }
        return original.apply(this, args);
      };
    });

    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);
    // ADR-0015 § 8: the overlay now shows a session-type choice screen
    // before either game starts -- pick "Quick Break" to reach the exact
    // same game-active state these Quick-Break-focused specs always
    // exercised before this slice.
    await page.getByRole('button', { name: 'Quick Break' }).click();

    const dialog = page.getByRole('dialog');
    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    // Error phase never had touch-action:'none' (only 'active' did), but
    // overscroll-behavior WAS unconditionally 'contain' pre-fix -- assert
    // it's gone here specifically.
    await expect(dialog).not.toHaveCSS('overscroll-behavior-y', 'contain');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    const after = await readGuardStyles(page);
    expect(after.htmlTouchAction).toBe('auto');
    expect(after.htmlOverscrollBehaviorY).toBe('auto');
    expect(after.bodyOverflowInlineStyle).toBe('');
    expect(after.dialogPresent).toBe(false);
  });
});
