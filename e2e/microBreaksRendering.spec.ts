import { expect, test } from '@playwright/test';

// MB-02b: these are the tests that would have caught the production
// incident before it shipped -- jsdom stubs canvas 2D entirely (see
// PongCanvas.test coverage under src/, and playwright.config.ts's own
// comment), so a color string that's invalid CSS never gets exercised
// there. This suite runs against a REAL browser's canvas + color parser.

const HARNESS_URL = '/__dev/micro-breaks-harness';
const START_BUTTON = '[data-testid="mb-harness-start"]';

test.describe('Micro Breaks canvas rendering (MB-02b)', () => {
  test('overlay opens, canvas draws real pixels, HUD + close control are visible, Esc restores the workspace', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);
    // ADR-0015 § 8: the overlay now shows a session-type choice screen
    // before either game starts -- pick "Quick Break" to reach the exact
    // same game-active state these Quick-Break-focused specs always
    // exercised before this slice.
    await page.getByRole('button', { name: 'Quick Break' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Let a handful of real animation frames run so the ball/paddle/trail
    // actually get drawn (not just the mount-time synchronous frame).
    await page.waitForTimeout(500);

    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { found: false, nonZeroPixels: 0, width: 0, height: 0 };
      const ctx = canvas.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let nonZeroPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) nonZeroPixels++;
      }
      return { found: true, nonZeroPixels, width: canvas.width, height: canvas.height };
    });

    expect(canvasInfo.found).toBe(true);
    expect(canvasInfo.width).toBeGreaterThan(0);
    expect(canvasInfo.height).toBeGreaterThan(0);
    // At least one non-transparent/non-black pixel -- proof something was
    // actually drawn, not just a cleared/black canvas (MB-02b's exact
    // symptom).
    expect(canvasInfo.nonZeroPixels).toBeGreaterThan(0);

    await expect(page.getByRole('button', { name: 'Close micro break' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    // Workspace restored: the harness's own trigger is enabled again,
    // meaning gameActive flipped back to false (see MicroBreaksDevHarness).
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  test('crash path: a draw() exception shows an in-overlay error state, never a silent black screen -- and Esc/close still work with no refresh', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    // Fault injection: force the first CanvasGradient.addColorStop call to
    // throw. This simulates a draw()-time exception via a real canvas API
    // fault, independent of the (now-fixed) color-format bug -- so this
    // test keeps proving the SAFETY NET even if colorNormalization.ts is
    // later changed in a way that stops any input from ever failing to
    // parse.
    await page.addInitScript(() => {
      const original = CanvasGradient.prototype.addColorStop;
      let thrown = false;
      CanvasGradient.prototype.addColorStop = function (...args) {
        if (!thrown) {
          thrown = true;
          throw new Error('MB-02b test-injected draw failure');
        }
        return original.apply(this, args as Parameters<typeof original>);
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
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close micro break' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    // The critical assertion: zero UNCAUGHT exceptions reached the page.
    // console.error diagnostic logging from the guard itself is expected
    // and is not a pageerror.
    expect(pageErrors).toEqual([]);
  });

  test('crash path via close button (not just Esc) also exits cleanly', async ({ page }) => {
    await page.addInitScript(() => {
      const original = CanvasGradient.prototype.addColorStop;
      let thrown = false;
      CanvasGradient.prototype.addColorStop = function (...args) {
        if (!thrown) {
          thrown = true;
          throw new Error('MB-02b test-injected draw failure');
        }
        return original.apply(this, args as Parameters<typeof original>);
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
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Close micro break' }).click();
    await expect(dialog).not.toBeVisible();
  });
});
