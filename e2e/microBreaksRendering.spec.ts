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

  // MB-16: the paddle IS the visual pointer during gameplay -- the native
  // OS cursor is hidden, scoped strictly to the <canvas> element, only
  // while it's actually mounted (which itself only happens during the
  // overlay's 'active' phase -- see MicroBreakOverlay.tsx's own render).
  test('native cursor is hidden over the canvas during active Quick Break gameplay, but normal everywhere else in the overlay (MB-16)', async ({
    page,
  }) => {
    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);

    // 'choosing' phase: no game running yet -- nothing should hide the
    // cursor here. There is no <canvas> at all in this phase (confirmed by
    // this same audit for the implementation), so the check is on the
    // dialog root itself -- proving no GLOBAL cursor:none leaked onto the
    // overlay shell.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const choosingCursor = await dialog.evaluate(el => getComputedStyle(el).cursor);
    expect(choosingCursor).not.toBe('none');

    await page.getByRole('button', { name: 'Quick Break' }).click();
    await page.waitForTimeout(300);

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const activeCanvasCursor = await canvas.evaluate(el => getComputedStyle(el).cursor);
    expect(activeCanvasCursor).toBe('none');

    // Scope-leak guard (MB-03-FIX precedent: verify the boundary, don't
    // assume it) -- the close button sits ABOVE the canvas (z-10) and is
    // never itself styled cursor:none, so hovering it must show a normal
    // cursor even though it visually sits near/over the canvas bounds.
    const closeButton = page.getByRole('button', { name: 'Close micro break' });
    await expect(closeButton).toBeVisible();
    const closeButtonCursor = await closeButton.evaluate(el => getComputedStyle(el).cursor);
    expect(closeButtonCursor).not.toBe('none');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('native cursor is normal (not hidden) during the crash/error state (MB-16)', async ({ page }) => {
    await page.addInitScript(() => {
      const original = CanvasGradient.prototype.addColorStop;
      let thrown = false;
      CanvasGradient.prototype.addColorStop = function (...args) {
        if (!thrown) {
          thrown = true;
          throw new Error('MB-16 test-injected draw failure');
        }
        return original.apply(this, args as Parameters<typeof original>);
      };
    });

    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);
    await page.getByRole('button', { name: 'Quick Break' }).click();

    const dialog = page.getByRole('dialog');
    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    // The canvas is unmounted immediately on crash (MB-02b's own teardown
    // guarantee) -- confirm there is nothing left to hide a cursor over,
    // and the error dialog itself has a normal cursor.
    await expect(page.locator('canvas')).toHaveCount(0);
    const errorCursor = await dialog.evaluate(el => getComputedStyle(el).cursor);
    expect(errorCursor).not.toBe('none');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
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
