import { expect, test } from '@playwright/test';

// MB-05, ADR-0015: real-browser smoke test for Orb Journey Slice 1,
// mirroring the MB-02b/MB-03-FIX smoke-test pattern established in
// microBreaksRendering.spec.ts -- jsdom cannot exercise canvas 2D at all
// (see this project's own "green jsdom proves nothing about canvas
// rendering" lesson), so the actual room theme rendering, room transition,
// and crash-guard behavior for Orb Journey need real-browser coverage the
// same way Quick Break's did.
//
// "Complete Room 1" is driven via a dev-only test hook
// (window.__orbJourneyDevForceRoomGoal, JourneyCanvas.tsx,
// import.meta.env.DEV-gated) rather than genuinely auto-playing the real
// physics with simulated pointer input -- the engine has no RNG, but
// reliably "catching" the ball would require the test script to replicate
// pongEngine.ts's own trajectory math frame-by-frame, which is a
// divergence-prone duplicate of the engine, not a real test. The hook sets
// the CURRENT room's combo to its goal; the actual room-complete transition
// still runs through the real stepJourney code path on the next tick.

const HARNESS_URL = '/__dev/micro-breaks-harness';
const START_BUTTON = '[data-testid="mb-harness-start"]';

async function openJourney(page: import('@playwright/test').Page) {
  await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
  await page.click(START_BUTTON);
  await page.getByRole('button', { name: 'Orb Journey' }).click();
}

async function forceRoomGoal(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __orbJourneyDevForceRoomGoal?: () => void }).__orbJourneyDevForceRoomGoal?.();
  });
}

test.describe('Orb Journey (MB-05, ADR-0015)', () => {
  test('choice screen -> Orb Journey -> Room 1 -> complete -> Room 2 (harder) -> Esc exits cleanly', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quick Break' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Orb Journey' })).toBeVisible();

    await page.getByRole('button', { name: 'Orb Journey' }).click();

    await expect(page.getByText('Room 1')).toBeVisible();
    await expect(page.getByText('Score: 0')).toBeVisible();
    await expect(page.getByText(/^Time:/)).not.toBeVisible(); // ADR-0015 §6: untimed, no countdown

    // Real canvas actually draws something (same non-zero-pixel proof
    // pattern as microBreaksRendering.spec.ts).
    await page.waitForTimeout(300);
    const beforeComplete = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { found: false, nonZeroPixels: 0 };
      const ctx = canvas.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let nonZeroPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) nonZeroPixels++;
      }
      return { found: true, nonZeroPixels };
    });
    expect(beforeComplete.found).toBe(true);
    expect(beforeComplete.nonZeroPixels).toBeGreaterThan(0);

    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();

    // Room 2 is a harder variant via room-index difficulty only (ADR-0015
    // §4/§7) -- unit-tested precisely in roomEngine.test.ts; here we only
    // confirm the transition actually reached room 2 and the game is still
    // alive (still drawing, no page error) rather than stuck/crashed.
    await page.waitForTimeout(300);
    const afterTransition = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { found: false, nonZeroPixels: 0 };
      const ctx = canvas.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let nonZeroPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) nonZeroPixels++;
      }
      return { found: true, nonZeroPixels };
    });
    expect(afterTransition.found).toBe(true);
    expect(afterTransition.nonZeroPixels).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  test('clearing the final configured room shows the "cleared" acknowledgement, and Journey keeps playing (no dead end, no game-over)', async ({ page }) => {
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();

    await forceRoomGoal(page); // clears room 1 -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page); // clears room 2, the LAST configured room this slice

    await expect(page.getByText('Rooms cleared — keep playing!')).toBeVisible();
    // Still room 2 (no room 3 authored, ADR-0015 §7) -- dialog remains open,
    // no game-over, matching ADR-0015 §1/§3's "no game over except Esc/close".
    await expect(page.getByText('Room 2')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('crash path in the Journey context: an in-overlay error state, never a silent black screen -- Esc still exits cleanly', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.addInitScript(() => {
      const original = CanvasGradient.prototype.addColorStop;
      let thrown = false;
      CanvasGradient.prototype.addColorStop = function (...args: Parameters<typeof original>) {
        if (!thrown) {
          thrown = true;
          throw new Error('MB-05 test-injected Journey draw failure');
        }
        return original.apply(this, args);
      };
    });

    await openJourney(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close micro break' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  test('Quick Break regression: choosing Quick Break still renders/exits correctly after this slice', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
    await page.click(START_BUTTON);
    await page.getByRole('button', { name: 'Quick Break' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-label', 'Micro break: Classic Pong');
    await expect(page.getByText(/^Time: 90s/)).toBeVisible(); // Quick Break's countdown, untouched by Journey

    await page.waitForTimeout(300);
    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { found: false, nonZeroPixels: 0 };
      const ctx = canvas.getContext('2d')!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let nonZeroPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) nonZeroPixels++;
      }
      return { found: true, nonZeroPixels };
    });
    expect(canvasInfo.found).toBe(true);
    expect(canvasInfo.nonZeroPixels).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });
});
