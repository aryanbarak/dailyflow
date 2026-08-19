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

// MB-07, ADR-0015 §10 (amendment): mirrors forceRoomGoal's own reasoning --
// positions the ball at Room 2's obstacle and raises combo to its break
// threshold, then lets the REAL stepPong/integrateSubstep collision-and-
// break logic run on the next tick. Does not shortcut the actual break path.
async function forceObstacleContact(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __orbJourneyDevForceObstacleContact?: () => void }).__orbJourneyDevForceObstacleContact?.();
  });
}

// There is no HUD text for obstacle state (unlike room/score) -- this
// dev-only getter is the only way to confirm "the obstacle is actually
// gone" from a real-browser test without pixel-diffing the canvas.
async function getObstacleBrokenState(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => (window as unknown as { __orbJourneyDevGetObstacleBrokenState?: () => readonly boolean[] }).__orbJourneyDevGetObstacleBrokenState?.(),
  );
}

// MB-08, ADR-0015 §11 (amendment): spawns AWAY from the ball (near the
// top), so it renders idle for at least one real frame before ever being
// caught -- see JourneyCanvas.tsx's own comment on why spawning and
// catching are deliberately split into two hooks.
async function spawnDriftingOrb(page: import('@playwright/test').Page, role: 'reward' | 'penalty') {
  await page.evaluate(orbRole => {
    (window as unknown as { __orbJourneyDevSpawnDriftingOrb?: (role: 'reward' | 'penalty') => void }).__orbJourneyDevSpawnDriftingOrb?.(orbRole);
  }, role);
}

async function forceDriftingOrbContact(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __orbJourneyDevForceDriftingOrbContact?: () => void }).__orbJourneyDevForceDriftingOrbContact?.();
  });
}

async function getBallSpeed(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __orbJourneyDevGetBallSpeed?: () => number }).__orbJourneyDevGetBallSpeed?.() ?? 0);
}

async function canvasHasNonZeroPixels(page: import('@playwright/test').Page): Promise<boolean> {
  const result = await page.evaluate(() => {
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
  return result.found && result.nonZeroPixels > 0;
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

  test('breakable obstacle (MB-07, ADR-0015 §10): Room 1 has none, Room 2s obstacle breaks on a sufficiently-combod hit and stays gone', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    expect(await getObstacleBrokenState(page)).toEqual([]); // Room 1: obstacle-free by design (ADR-0015 §7/§10)

    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();
    expect(await getObstacleBrokenState(page)).toEqual([false]); // Room 2: exactly one obstacle, intact

    await forceObstacleContact(page);
    await page.waitForTimeout(300); // let the next tick's real collision-and-break logic run
    expect(await getObstacleBrokenState(page)).toEqual([true]);

    // Rendering continues fine post-break -- no crash, the canvas still draws.
    expect(await canvasHasNonZeroPixels(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  test('crash-guard covers Room 2s NEW obstacle-drawing code path (verified, not assumed, per the MB-02b/MB-03-FIX fault-injection pattern)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page); // Room 1 -> Room 2, where the obstacle actually exists
    await expect(page.getByText('Room 2')).toBeVisible();

    // Injected AFTER reaching Room 2 (not via addInitScript at load, unlike
    // the earlier crash test) so the very next roundRect() call is
    // guaranteed to occur inside a renderFrame() invocation that ALSO draws
    // Room 2's obstacle (drawRoomTheme's decorative cards and
    // drawRoomObstacle both call roundRect within the same synchronous
    // render pass) -- this exercises the crash guard against a frame where
    // this slice's new rendering code is actually part of the call stack,
    // not just the pre-existing ball/theme draw calls the MB-02b/MB-03-FIX
    // and earlier Journey crash tests already cover.
    await page.evaluate(() => {
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.roundRect;
      let thrown = false;
      proto.roundRect = function (...args: Parameters<typeof original>) {
        if (!thrown) {
          thrown = true;
          throw new Error('MB-07 test-injected obstacle-draw failure');
        }
        return original.apply(this, args);
      };
    });

    const dialog = page.getByRole('dialog');
    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close micro break' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  test('drifting speed-orbs (MB-08, ADR-0015 §11): catching Haste measurably increases ball speed, catching Calm measurably decreases it', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page); // Room 1 -> Room 2, where drifting orbs exist
    await expect(page.getByText('Room 2')).toBeVisible();

    const baselineSpeed = await getBallSpeed(page);
    expect(baselineSpeed).toBeGreaterThan(0);

    await spawnDriftingOrb(page, 'penalty');
    await forceDriftingOrbContact(page);
    await page.waitForTimeout(200); // let the next tick's real contact-and-multiplier logic run
    const speedAfterHaste = await getBallSpeed(page);
    expect(speedAfterHaste).toBeGreaterThan(baselineSpeed);

    // A Calm catch right after -- per ADR-0015 §11 "effects do not stack; a
    // new contact refreshes duration, not magnitude," a DIFFERENT-role
    // contact replaces the active effect rather than stacking on top of it,
    // so this is still a valid, measurable comparison regardless of the
    // still-active Haste window.
    await spawnDriftingOrb(page, 'reward');
    await forceDriftingOrbContact(page);
    await page.waitForTimeout(200);
    const speedAfterCalm = await getBallSpeed(page);
    expect(speedAfterCalm).toBeLessThan(speedAfterHaste);
    expect(speedAfterCalm).toBeLessThan(baselineSpeed);

    expect(await canvasHasNonZeroPixels(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  test('drifting-orb idle rim distinguishes role via a real, non-color canvas cue (setLineDash) -- reward always smooth, penalty at least sometimes dashed (ADR-0015 §11)', async ({ page }) => {
    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __dashCalls: number[][] }).__dashCalls = [];
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.setLineDash;
      proto.setLineDash = function (segments: number[]) {
        (window as unknown as { __dashCalls: number[][] }).__dashCalls.push([...segments]);
        return original.call(this, segments);
      };
    });

    await spawnDriftingOrb(page, 'reward');
    await page.waitForTimeout(200);
    const rewardDashCalls = await page.evaluate(() => (window as unknown as { __dashCalls: number[][] }).__dashCalls);
    expect(rewardDashCalls.length).toBeGreaterThan(0);
    expect(rewardDashCalls.every(call => call.length === 0)).toBe(true); // reward: always a smooth, undashed rim

    await page.evaluate(() => {
      (window as unknown as { __dashCalls: number[][] }).__dashCalls = [];
    });
    await spawnDriftingOrb(page, 'penalty');
    await page.waitForTimeout(200);
    const penaltyDashCalls = await page.evaluate(() => (window as unknown as { __dashCalls: number[][] }).__dashCalls);
    expect(penaltyDashCalls.some(call => call.length > 0)).toBe(true); // penalty: at least one call uses a real dash pattern

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('the rim-shape role distinction is UNAFFECTED by reduced motion (a static shape, not animation -- ADR-0015 §11)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __dashCalls: number[][] }).__dashCalls = [];
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.setLineDash;
      proto.setLineDash = function (segments: number[]) {
        (window as unknown as { __dashCalls: number[][] }).__dashCalls.push([...segments]);
        return original.call(this, segments);
      };
    });

    await spawnDriftingOrb(page, 'penalty');
    await page.waitForTimeout(200);
    const penaltyDashCalls = await page.evaluate(() => (window as unknown as { __dashCalls: number[][] }).__dashCalls);
    expect(penaltyDashCalls.some(call => call.length > 0)).toBe(true); // still dashed, even under reduced motion

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('crash-guard covers Room 2s NEW drifting-orb rendering code path (setLineDash is exclusive to drifting-orb drawing -- a cleanly isolated proof, verified not assumed)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();
    await spawnDriftingOrb(page, 'reward');

    await page.evaluate(() => {
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.setLineDash;
      let thrown = false;
      proto.setLineDash = function (...args: Parameters<typeof original>) {
        if (!thrown) {
          thrown = true;
          throw new Error('MB-08 test-injected drifting-orb draw failure');
        }
        return original.apply(this, args);
      };
    });

    const dialog = page.getByRole('dialog');
    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close micro break' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });
});
