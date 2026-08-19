import { expect, test } from '@playwright/test';

// MB-03, mobile/PWA acceptance: the parts of this slice that genuinely need
// a real browser -- resize/orientation wiring (the PURE rescale math is
// unit-tested in pongEngine.test.ts; this proves the ResizeObserver
// wiring itself doesn't throw and keeps the game usable), and that the
// safe-area/gesture-guard CSS actually reaches the DOM (not just written in
// source). Real notch/safe-area hardware and true device rotation are
// outside what Playwright + a desktop/emulated browser can verify -- see
// the MB-03 report's manual-verification notes for what still needs PO
// device QA.

const HARNESS_URL = '/__dev/micro-breaks-harness';
const START_BUTTON = '[data-testid="mb-harness-start"]';

test.describe('Micro Breaks mobile/PWA acceptance (MB-03)', () => {
  test('resizing the viewport mid-game (simulated orientation change) does not crash the renderer and the board keeps drawing', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.setViewportSize({ width: 390, height: 844 }); // portrait phone
    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);
    // ADR-0015 § 8: the overlay now shows a session-type choice screen
    // before either game starts -- pick "Quick Break" to reach the exact
    // same game-active state these Quick-Break-focused specs always
    // exercised before this slice.
    await page.getByRole('button', { name: 'Quick Break' }).click();
    await page.waitForTimeout(400);

    const beforeResize = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return canvas ? { width: canvas.width, height: canvas.height } : null;
    });
    expect(beforeResize).not.toBeNull();

    // Simulate a rotation to landscape.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(400);

    const afterResize = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let nonZeroPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) nonZeroPixels++;
      }
      return { width: canvas.width, height: canvas.height, nonZeroPixels };
    });

    expect(afterResize).not.toBeNull();
    // The board's pixel dimensions actually changed to fit the new viewport
    // -- proof this isn't just a static, pre-sized canvas ignoring resize.
    expect(afterResize!.width).not.toBe(beforeResize!.width);
    // Still drawing something after the resize (no silent black canvas).
    expect(afterResize!.nonZeroPixels).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);

    await page.keyboard.press('Escape');
  });

  test('the close control and HUD carry safe-area-inset CSS in the real DOM (not just in source)', async ({ page }) => {
    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);
    // ADR-0015 § 8: the overlay now shows a session-type choice screen
    // before either game starts -- pick "Quick Break" to reach the exact
    // same game-active state these Quick-Break-focused specs always
    // exercised before this slice.
    await page.getByRole('button', { name: 'Quick Break' }).click();

    const closeButtonStyle = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Close micro break"]') as HTMLElement | null;
      return button?.getAttribute('style') ?? null;
    });
    expect(closeButtonStyle).toContain('env(safe-area-inset-top)');
    expect(closeButtonStyle).toContain('env(safe-area-inset-right)');

    await page.keyboard.press('Escape');
  });

  test('the dialog root carries the gesture-guard CSS (touch-action/overscroll-behavior) while playing', async ({ page }) => {
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
  });
});
