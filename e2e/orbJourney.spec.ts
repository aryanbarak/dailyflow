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

// MB-10, ADR-0015 §11 (revision): mirrors forceDriftingOrbContact's own
// approach -- teleports the orb onto the paddle (not the ball) and lets the
// REAL circle-vs-paddle-rect contact logic resolve it on the next tick.
async function forcePaddleOrbCatch(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __orbJourneyDevForcePaddleOrbCatch?: () => void }).__orbJourneyDevForcePaddleOrbCatch?.();
  });
}

// MB-10, ADR-0015 §11 (revision): teleports the orb well past the bottom
// edge and lets the REAL bottom-miss logic resolve it on the next tick.
async function forceOrbBottomMiss(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __orbJourneyDevForceOrbBottomMiss?: () => void }).__orbJourneyDevForceOrbBottomMiss?.();
  });
}

async function getBallSpeed(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __orbJourneyDevGetBallSpeed?: () => number }).__orbJourneyDevGetBallSpeed?.() ?? 0);
}

// MB-10: read-only, used to confirm a forced contact actually happened (the
// orb is gone) alongside a speed-change assertion -- see the paddle-catch
// test's own comment for why a bare "speed unchanged" check isn't enough.
async function getDriftingOrbCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __orbJourneyDevGetDriftingOrbCount?: () => number }).__orbJourneyDevGetDriftingOrbCount?.() ?? -1);
}

// MB-11: deterministically simulates "the physics/update step threw" --
// there's no shared browser API to monkey-patch for the physics path the
// way the render-path crash tests monkey-patch canvas methods, so this is
// the direct substitute (see JourneyCanvas.tsx's forceNextTickThrowRef).
async function forceNextTickThrow(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __orbJourneyDevForceNextTickThrow?: () => void }).__orbJourneyDevForceNextTickThrow?.();
  });
}

// MB-12: same "manipulate state inputs, let real physics run" methodology as
// the other hooks above -- cheaply simulates "many real minutes of
// continuous play" by jumping the pong session's elapsedSeconds forward,
// rather than actually waiting minutes in a real-time test.
async function forceElapsedSeconds(page: import('@playwright/test').Page, seconds: number) {
  await page.evaluate(s => {
    (window as unknown as { __orbJourneyDevForceElapsedSeconds?: (seconds: number) => void }).__orbJourneyDevForceElapsedSeconds?.(s);
  }, seconds);
}

// MB-13: cumulative, monotonic drifting-orb spawn count -- see
// JourneyCanvas.tsx's own comment on why this is used for spawn-RATE
// comparisons instead of the (fluctuating, removal-affected)
// __orbJourneyDevGetDriftingOrbCount above.
async function getDriftingOrbSpawnCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __orbJourneyDevGetDriftingOrbSpawnCount?: () => number }).__orbJourneyDevGetDriftingOrbSpawnCount?.() ?? -1,
  );
}

// MB-18, ADR-0015 §3 (correction): same "manipulate state inputs, let real
// physics run" methodology as forceOrbBottomMiss -- positions the ball
// definitively past the floor with a downward velocity so the next tick's
// REAL floor-miss branch resolves it, then lets stepJourney's own
// grace/full-restart branching run unmodified.
async function forceFloorMiss(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __orbJourneyDevForceFloorMiss?: () => void }).__orbJourneyDevForceFloorMiss?.();
  });
}

async function getMissCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __orbJourneyDevGetMissCount?: () => number }).__orbJourneyDevGetMissCount?.() ?? -1);
}

async function isReactionActive(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __orbJourneyDevIsReactionActive?: () => boolean }).__orbJourneyDevIsReactionActive?.() ?? false,
  );
}

// MB-26, ADR-0015 §15: mirrors forceRoomGoal's own reasoning -- calls the
// REAL public requestPaddleJump entry point, so room-gating, cooldown, and
// hop timing all resolve exactly as the real keyboard/touch handlers would.
async function triggerPaddleJump(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __orbJourneyDevTriggerPaddleJump?: () => void }).__orbJourneyDevTriggerPaddleJump?.();
  });
}

type PaddleJumpDevState = { active: boolean; elapsedMs: number; cooldownRemainingMs: number; hitCount: number; enabledThisRoom: boolean };
async function getPaddleJumpState(page: import('@playwright/test').Page): Promise<PaddleJumpDevState> {
  return page.evaluate(
    () =>
      (window as unknown as { __orbJourneyDevGetPaddleJumpState?: () => PaddleJumpDevState }).__orbJourneyDevGetPaddleJumpState?.() ?? {
        active: false,
        elapsedMs: 0,
        cooldownRemainingMs: 0,
        hitCount: 0,
        enabledThisRoom: false,
      },
  );
}

// MB-13: average canvas color across the WHOLE frame -- a room's theme
// (background, drawn first and covering most of the board) dominates this
// average far more than the small ball/paddle/orbs, so a meaningfully
// different average color between two rooms is real evidence the THEME
// changed, not just that gameplay objects moved to different positions.
async function averageCanvasColor(page: import('@playwright/test').Page): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    return { r: r / count, g: g / count, b: b / count };
  });
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

  // MB-13, ADR-0015 §12: this test's own boundary moved -- Room 2 is no
  // longer the last configured room, so clearing it must now advance to
  // Room 3 ('playing'), and 'cleared' must not appear until Room 3 itself
  // is cleared. Explicit, not assumed -- this IS the exact boundary
  // condition Room 3's addition changed.
  test('clearing room 2 now advances to room 3 (not "cleared"); clearing room 3 shows the "cleared" acknowledgement and Journey keeps playing (no dead end, no game-over)', async ({
    page,
  }) => {
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();

    await forceRoomGoal(page); // clears room 1 -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page); // clears room 2 -> room 3 (NOT "cleared" -- room 2 is no longer the last room, post-MB-13)

    await expect(page.getByText('Room 3')).toBeVisible();
    await expect(page.getByText('Rooms cleared — keep playing!')).not.toBeVisible();

    await forceRoomGoal(page); // clears room 3, the LAST configured room as of MB-13

    await expect(page.getByText('Rooms cleared — keep playing!')).toBeVisible();
    // Still room 3 -- dialog remains open, no game-over, matching ADR-0015
    // §1/§3's "no game over except Esc/close".
    await expect(page.getByText('Room 3')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  // MB-16: the paddle IS the visual pointer during gameplay -- native
  // cursor hidden, scoped to the canvas element. Journey's 'cleared' phase
  // (MB-05: physics keep running, paddle stays live) is a sub-state of the
  // overlay's OWN 'active' phase, never a separate mount/unmount -- so the
  // canvas element's cursor:none, applied unconditionally at mount, covers
  // 'playing' AND 'cleared' automatically. Verified explicitly here, not
  // assumed from the implementation's own reasoning.
  test('native cursor is hidden over the canvas during Journey "playing" AND stays hidden through "cleared" -- normal everywhere else (MB-16)', async ({
    page,
  }) => {
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(300);

    const canvas = page.locator('canvas');
    const playingCursor = await canvas.evaluate(el => getComputedStyle(el).cursor);
    expect(playingCursor).toBe('none');

    // Scope-leak guard, Journey context: the close button must still show
    // a normal cursor even while the canvas underneath it is cursor:none.
    const closeButton = page.getByRole('button', { name: 'Close micro break' });
    const closeButtonCursor = await closeButton.evaluate(el => getComputedStyle(el).cursor);
    expect(closeButtonCursor).not.toBe('none');

    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page); // -> room 3
    await expect(page.getByText('Room 3')).toBeVisible();
    await forceRoomGoal(page); // clears room 3, the LAST configured room -- enters 'cleared'
    await expect(page.getByText('Rooms cleared — keep playing!')).toBeVisible();

    const clearedCursor = await canvas.evaluate(el => getComputedStyle(el).cursor);
    expect(clearedCursor).toBe('none'); // paddle still live in 'cleared' -- cursor stays hidden, not restored

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  // MB-13, ADR-0015 §12: proves Room 3s Rhythm/Calendar theme is visibly
  // distinct from Room 1/2s Focus/Tasks theme -- not just a different
  // theme ID in state, an actually different rendered frame. Average color
  // across the WHOLE canvas (see averageCanvasColor's own comment) isolates
  // the THEME's contribution (background, drawn first, covering most of the
  // board) from incidental ball/paddle/orb position differences between
  // the two samples.
  test('Room 3s Rhythm/Calendar theme renders visibly distinct from Room 1/2s Focus/Tasks theme (MB-13: grid/bars vs cards/checkmarks)', async ({
    page,
  }) => {
    await openJourney(page);
    await forceRoomGoal(page); // -> room 2 (focus-tasks)
    await expect(page.getByText('Room 2')).toBeVisible();
    await page.waitForTimeout(250);
    const room2Color = await averageCanvasColor(page);

    await forceRoomGoal(page); // -> room 3 (rhythm-calendar)
    await expect(page.getByText('Room 3')).toBeVisible();
    await page.waitForTimeout(250);
    const room3Color = await averageCanvasColor(page);

    const distance = Math.hypot(room3Color.r - room2Color.r, room3Color.g - room2Color.g, room3Color.b - room2Color.b);
    expect(distance).toBeGreaterThan(2); // a real, meaningfully different average color, not floating-point noise
  });

  // MB-13, ADR-0015 §12: proves Room 3s ONE content lever (a faster
  // drifting-orb spawn cadence) is real, measured via the engine's own
  // cumulative spawn counter over a bounded, identical-length real-time
  // window in each room -- not asserted from the tuning constants alone
  // (which could be right in tuning.ts but never actually wired through
  // buildDriftingOrbSpawnConfig). Runs an in-page driver loop (MB-11 soak's
  // own pattern -- avoids per-iteration Playwright round-trip latency) that
  // tracks the ball's real X position with the paddle every frame, via the
  // __orbJourneyDevGetBallFraction hook -- WITHOUT this, the stationary
  // paddle causes frequent floor misses, each of which resets
  // driftingOrbSpawnElapsedMs via the room-local restart path and can starve
  // the spawn interval entirely (observed directly: 0 spawns in 9s without
  // paddle tracking).
  test('Room 3s drifting orbs spawn measurably more frequently than Room 2s, within a bounded observation window (MB-13)', async ({ page }) => {
    await openJourney(page);
    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();

    const measureSpawnsOverWindow = (windowMs: number) =>
      page.evaluate(async durationMs => {
        type Hooks = {
          __orbJourneyDevGetBallFraction?: () => { x: number; y: number };
          __orbJourneyDevGetDriftingOrbSpawnCount?: () => number;
        };
        const w = window as unknown as Hooks;
        const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;

        const dispatchPointer = (clientX: number, clientY: number) => {
          canvasEl.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, bubbles: true, cancelable: true, pointerId: 1 }));
        };

        const start = performance.now();
        const startCount = w.__orbJourneyDevGetDriftingOrbSpawnCount?.() ?? -1;
        while (performance.now() - start < durationMs) {
          const rect = canvasEl.getBoundingClientRect();
          const frac = w.__orbJourneyDevGetBallFraction?.();
          if (frac) dispatchPointer(rect.left + frac.x * rect.width, rect.top + rect.height - 20);
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        const endCount = w.__orbJourneyDevGetDriftingOrbSpawnCount?.() ?? -1;
        return endCount - startCount;
      }, windowMs);

    const windowMs = 9000;
    const room2Spawns = await measureSpawnsOverWindow(windowMs);

    await forceRoomGoal(page); // -> room 3
    await expect(page.getByText('Room 3')).toBeVisible();
    const room3Spawns = await measureSpawnsOverWindow(windowMs);

    expect(room2Spawns).toBeGreaterThan(0); // sanity: room 2 spawned at least once in the window
    expect(room3Spawns).toBeGreaterThan(room2Spawns); // room 3s shorter interval spawns strictly more in the SAME window
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

  // MB-09, ADR-0015 §10 (retirement note): the static breakable obstacle is
  // now retired from Room 2's authored content -- Room 1 and Room 2 are
  // symmetric (both obstacle-free). The MB-07 dev hooks stay wired (the
  // engine-level capability is kept, not deleted) but now have nothing to
  // act on; this test replaces the old "Room 2's obstacle breaks" MB-07
  // test with a proof that the retirement is real AND that the now-inert
  // hook degrades to a safe no-op instead of throwing.
  test('breakable obstacle retirement (MB-09, ADR-0015 §10 retirement note): Room 2 no longer has one, mirroring Room 1 -- the MB-07 dev hook is now a safe no-op', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    expect(await getObstacleBrokenState(page)).toEqual([]); // Room 1: obstacle-free by design (ADR-0015 §7/§10)

    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();
    expect(await getObstacleBrokenState(page)).toEqual([]); // MB-09: Room 2 is now ALSO obstacle-free

    await forceObstacleContact(page); // no obstacle to contact -- must no-op, not throw
    await page.waitForTimeout(300);
    expect(await getObstacleBrokenState(page)).toEqual([]);

    // Rendering continues fine with zero obstacles -- no crash, canvas still draws.
    expect(await canvasHasNonZeroPixels(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  // MB-09: the MB-07 "crash-guard covers Room 2's NEW obstacle-drawing code
  // path" test is REMOVED (not merely updated) -- its whole premise was
  // roundRect() being called from BOTH the decorative theme cards AND
  // drawRoomObstacle() within the same render pass, guaranteeing the new
  // obstacle-drawing code was on the call stack. With Room 2's obstacle list
  // now empty, drawRoomObstacle() is never invoked in real gameplay, so that
  // guarantee no longer holds -- keeping the test would only be re-proving
  // the PRE-EXISTING theme-card crash guard, already covered by this file's
  // earlier "crash path in the Journey context" test, under a misleading
  // "NEW obstacle-drawing" name. Crash-guard coverage of Room 2's actual
  // CURRENT new render code is provided by the drifting-orb crash-guard test
  // below (setLineDash is exclusive to drawDriftingOrbIdle, a cleaner
  // isolation than roundRect ever was).

  test('drifting speed-orbs (MB-08, ADR-0015 §11; contact behavior REVISED by MB-10): a SEQUENCE of reward catches cumulatively/compoundingly increases ball speed, not just a one-time bump', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page); // Room 1 -> Room 2, where drifting orbs exist
    await expect(page.getByText('Room 2')).toBeVisible();

    const baselineSpeed = await getBallSpeed(page);
    expect(baselineSpeed).toBeGreaterThan(0);

    await spawnDriftingOrb(page, 'reward');
    await forceDriftingOrbContact(page);
    await page.waitForTimeout(200); // let the next tick's real contact-and-speed-step logic run
    const speedAfterFirstReward = await getBallSpeed(page);
    expect(speedAfterFirstReward).toBeGreaterThan(baselineSpeed);

    // MB-10: effects COMPOUND (the opposite of MB-08's retired "refresh,
    // don't stack" rule) -- a SECOND reward catch must push speed higher
    // STILL, proving this isn't a one-time bump that plateaus.
    await spawnDriftingOrb(page, 'reward');
    await forceDriftingOrbContact(page);
    await page.waitForTimeout(200);
    const speedAfterSecondReward = await getBallSpeed(page);
    expect(speedAfterSecondReward).toBeGreaterThan(speedAfterFirstReward);

    expect(await canvasHasNonZeroPixels(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  test('drifting speed-orbs (MB-10, ADR-0015 §11 revision): a penalty-role orb caught by the PADDLE causes NO speed change (a successful defensive block)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();
    // MB-15: the room-1->2 play-area CSS width transition (and the
    // ResizeObserver-driven rescalePongState it triggers, which DOES scale
    // ballVelocity proportionally to the width change -- see
    // pongEngine.ts's own rescalePongState) is still settling for a moment
    // after the room-transition text appears. MB-15's genuinely-narrow
    // Room 1 baseline makes this a proportionally BIGGER width jump than
    // MB-14's ~480->711px one was (~300->551px, a larger ratio), which is
    // what surfaced this as a real flake -- sampling "speed before" mid-
    // transition and "speed after" once it's settled looks like a speed
    // CHANGE that has nothing to do with the paddle-catch mechanic this
    // test is actually about. Let it settle first, same wait MB-14s own
    // play-area tests already use.
    await page.waitForTimeout(600);

    const speedBefore = await getBallSpeed(page);
    expect(speedBefore).toBeGreaterThan(0);

    await spawnDriftingOrb(page, 'penalty');
    expect(await getDriftingOrbCount(page)).toBe(1); // sanity: a real orb exists to be caught
    await forcePaddleOrbCatch(page);
    await page.waitForTimeout(200); // let the next tick's real paddle-contact logic run
    // Paired assertion, deliberately: "speed unchanged" ALONE can't be
    // disproven by an inert/no-op hook (nothing happening also leaves speed
    // unchanged) -- pairing it with "the orb is actually gone" requires the
    // real paddle-contact code to have run.
    expect(await getDriftingOrbCount(page)).toBe(0);
    const speedAfter = await getBallSpeed(page);
    expect(speedAfter).toBeCloseTo(speedBefore, 0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('drifting speed-orbs (MB-10, ADR-0015 §11 revision): a penalty-role orb reaching the bottom UNCAUGHT measurably decreases ball speed, same as a direct hit', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();
    // MB-15: same settle-wait rationale as the paddle-catch test above --
    // this test's expected DECREASE could be masked/offset by the room-
    // transition width-resize's own (positive, growth-direction) velocity
    // rescale if sampled mid-transition. Passed without this wait under the
    // current constants, but shares the identical fragility class -- fixed
    // for genuine robustness, not just because it happened to fail.
    await page.waitForTimeout(600);

    const speedBefore = await getBallSpeed(page);
    expect(speedBefore).toBeGreaterThan(0);

    await spawnDriftingOrb(page, 'penalty');
    await forceOrbBottomMiss(page);
    await page.waitForTimeout(200); // let the next tick's real bottom-miss logic run
    const speedAfter = await getBallSpeed(page);
    expect(speedAfter).toBeLessThan(speedBefore);

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

  test('crash-guard covers the NEW paddle-catch reaction rendering code path (MB-10, ADR-0015 §11 revision -- verified, not assumed)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();

    // Triggers the REAL paddle-catch path first (spawn a penalty orb, force
    // it onto the paddle, let one real tick resolve it) so the paddle-catch
    // pulse's render branch (`now < paddleCatchReactionUntilRef.current` in
    // JourneyCanvas.tsx) is GUARANTEED active before the fault is injected
    // -- the new code is provably on the call stack for the frame that
    // fails, not just theoretically reachable. `ctx.arc` is shared with
    // the ball/trail/particles (unlike setLineDash's clean isolation for
    // the idle-rim test above), so this mirrors MB-07's own
    // timing-guaranteed-overlap pattern rather than MB-08's exclusive-API
    // pattern.
    await spawnDriftingOrb(page, 'penalty');
    await forcePaddleOrbCatch(page);
    await page.waitForTimeout(200);
    // Confirms the real paddle-catch actually happened (not an inert hook)
    // BEFORE injecting the fault -- ctx.arc is shared with the ball/trail/
    // particles, so an error overlay appearing below is not on its own proof
    // the NEW code was active; this orb-count check is what makes that claim
    // non-trivial (it would fail immediately on a reverted implementation,
    // before the fault-injection half of the test even runs).
    expect(await getDriftingOrbCount(page)).toBe(0);

    await page.evaluate(() => {
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.arc;
      let thrown = false;
      proto.arc = function (...args: Parameters<typeof original>) {
        if (!thrown) {
          thrown = true;
          throw new Error('MB-10 test-injected paddle-catch-reaction draw failure');
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

  // MB-11 (High-severity fix): PO reported a mid-game freeze in Room 2 --
  // paddle still responsive, everything else static, NO error overlay
  // (unlike MB-02b's crash-guard incident). Root cause: the physics step
  // (stepJourney) and the VFX-detection logic in JourneyCanvas.tsx's onTick
  // ran completely OUTSIDE any try/catch -- only draw()/renderFrame() had
  // crash-guard coverage. An uncaught exception there kills the rAF
  // callback's synchronous execution before it reaches its own
  // requestAnimationFrame(tick) call, silently stopping the animation chain
  // forever, while independent listeners (pointermove) keep working.
  // Confirmed via extensive real-browser fuzzing (~2,500 iterations / 90s
  // of aggressive same-tick multi-orb/forced-restart stress) that this is a
  // structural gap, not something that reproduces from a specific known
  // orb-event sequence -- so this test proves the FIX deterministically via
  // fault injection (the __orbJourneyDevForceNextTickThrow dev hook),
  // exactly mirroring how the render-path crash tests above prove their own
  // guard via monkey-patched canvas methods, since there is no equivalent
  // shared browser API to intercept for the physics path.
  test('physics/update-step crash-guard (MB-11): an uncaught exception in the physics/VFX path now produces the SAME recoverable error state as a render exception', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();

    await forceNextTickThrow(page);
    await page.waitForTimeout(300); // let the next tick actually run and throw

    const dialog = page.getByRole('dialog');
    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close micro break' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    // The exception was caught INSIDE the app (same crash() path as a
    // render error) -- it must never reach the browser as an uncaught
    // exception. This is also what distinguishes "fixed" from "the bug":
    // pre-fix, this same injected throw would show up here instead of
    // producing the overlay above.
    expect(pageErrors).toEqual([]);
  });

  // MB-11: permanent soak/fuzz regression net -- catches ANY future
  // uncaught exception anywhere in the physics/update path automatically,
  // not just the one incident this task investigated. Runs an in-page
  // driver loop (avoids per-iteration Playwright round-trip latency so it
  // can hammer many forced events per real second) for a bounded real-time
  // duration, randomizing paddle input and firing BURSTS of 0-6 forced
  // drifting-orb dev-hook calls per frame with NO yield in between (same-
  // tick multi-orb resolution, the edge case MB-10's own report flagged),
  // plus periodic forced floor-misses (room-local restarts) while orbs and
  // reaction windows are active. Freeze detection uses a canvas pixel-hash
  // sampled once per real animation frame -- NOT ball-speed sampling, which
  // produces a false positive here (speed is naturally constant between
  // paddle/orb events, since only direction changes on a wall bounce).
  test('physics/update-path soak: extended randomized play with rapid drifting-orb events never freezes the game or throws uncaught (MB-11 regression net)', async ({
    page,
  }) => {
    test.setTimeout(45000);
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas bounding box -- cannot drive synthetic pointer input');

    const result = await page.evaluate(
      async ({ durationMs, paddleXBase, paddleYBase }) => {
        type Hooks = {
          __orbJourneyDevSpawnDriftingOrb?: (role: 'reward' | 'penalty') => void;
          __orbJourneyDevForceDriftingOrbContact?: () => void;
          __orbJourneyDevForcePaddleOrbCatch?: () => void;
          __orbJourneyDevForceOrbBottomMiss?: () => void;
        };
        const w = window as unknown as Hooks;
        const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
        const ctx = canvasEl.getContext('2d')!;

        let capturedError: string | null = null;
        const onErr = (event: ErrorEvent) => {
          capturedError = event.error?.stack ?? event.message;
        };
        window.addEventListener('error', onErr);

        const dispatchPointer = (x: number, y: number) => {
          canvasEl.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1 }));
        };

        // Cheap-ish pixel hash: samples every 97th byte of the canvas
        // buffer -- sensitive to any movement anywhere on the board
        // without scanning the full buffer every frame.
        const snapshot = () => {
          const { data } = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
          let hash = 0;
          for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) | 0;
          return hash;
        };

        const start = performance.now();
        let iterations = 0;
        const recentHashes: number[] = [];
        let frozen = false;

        while (performance.now() - start < durationMs) {
          iterations++;
          const forcingMiss = iterations % 47 < 4;
          dispatchPointer(forcingMiss ? paddleXBase - 500 : paddleXBase + (Math.random() - 0.5) * 300, paddleYBase);

          const actions = Math.floor(Math.random() * 7);
          for (let a = 0; a < actions; a++) {
            const roll = Math.random();
            if (roll < 0.25) w.__orbJourneyDevSpawnDriftingOrb?.(Math.random() < 0.5 ? 'reward' : 'penalty');
            else if (roll < 0.45) w.__orbJourneyDevForceDriftingOrbContact?.();
            else if (roll < 0.75) w.__orbJourneyDevForcePaddleOrbCatch?.();
            else w.__orbJourneyDevForceOrbBottomMiss?.();
          }
          if (Math.random() < 0.6) w.__orbJourneyDevSpawnDriftingOrb?.(Math.random() < 0.5 ? 'reward' : 'penalty');

          if (capturedError) break;
          await new Promise(resolve => requestAnimationFrame(resolve));
          if (capturedError) break;

          const hash = snapshot();
          recentHashes.push(hash);
          if (recentHashes.length > 40) recentHashes.shift();
          if (recentHashes.length === 40 && new Set(recentHashes).size === 1 && iterations > 80) {
            frozen = true;
            break;
          }
        }

        window.removeEventListener('error', onErr);
        return { iterations, capturedError, frozen };
      },
      { durationMs: 15000, paddleXBase: box.x + box.width / 2, paddleYBase: box.y + box.height - 20 },
    );

    expect(result.capturedError).toBeNull();
    expect(result.frozen).toBe(false);
    expect(result.iterations).toBeGreaterThan(100); // sanity: the loop actually ran, not a setup failure

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  // MB-12: root cause was NOT an exception (MB-11's guard correctly does not
  // fire here -- there is nothing for it to catch). pongEngine.ts's stepPong
  // sets PongState.status to 'ended' once elapsedSeconds reaches
  // config.durationSeconds, and permanently no-ops on every subsequent call
  // once 'ended' -- correct, tested, load-bearing behavior for Quick Break's
  // actually-timed sessions (see pongEngine.test.ts), but Journey rooms
  // inherited Quick Break's 90s default with nothing to reset elapsedSeconds
  // except a room-local restart (miss) or room transition -- neither of
  // which ever happens again once the LAST room is cleared. Any single
  // uninterrupted room attempt lasting 90 continuous seconds silently froze
  // the ball/orbs/HUD forever (paddle stayed responsive -- it's set directly
  // by the pointer handler, independent of this engine call), with no
  // exception anywhere. Fixed by giving Journey rooms an unbounded
  // durationSeconds (roomEngine.ts's deriveRoomEngineConfig) rather than
  // touching stepPong's ended-state freeze itself.
  //
  // This test proves the FIX deterministically via the
  // __orbJourneyDevForceElapsedSeconds dev hook (same "manipulate state
  // inputs, let real physics run" methodology as every other dev hook in
  // this file) -- jumping elapsedSeconds to just under, then well past, the
  // legacy 90s boundary, and confirming the ball keeps moving across it.
  test('sustained cleared-phase play never silently freezes past the legacy 90s session-duration boundary (MB-12)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page); // clears room 1 -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page); // clears room 2 -> room 3 (MB-13: room 2 is no longer the last room)
    await expect(page.getByText('Room 3')).toBeVisible();
    await forceRoomGoal(page); // clears room 3, the LAST configured room as of MB-13 -- enters 'cleared'
    await expect(page.getByText('Rooms cleared — keep playing!')).toBeVisible();

    const ballSpeedBefore = await getBallSpeed(page);
    expect(ballSpeedBefore).toBeGreaterThan(0); // sanity: the ball is genuinely in flight, not stalled for an unrelated reason

    // Jump to just under the legacy 90s boundary, then let real ticks carry
    // it across -- this is the EXACT moment the bug fired pre-fix.
    await forceElapsedSeconds(page, 89.5);

    // Canvas pixel-hash freeze detector, MB-11's own methodology -- the
    // decisive, render-level confirmation that the WHOLE frame (ball, orbs,
    // trail) is still animating across the boundary, not just one numeric
    // reading (ball speed magnitude alone is not a reliable freeze signal --
    // see the MB-11 soak's own comment on why).
    const sampleFrozen = () =>
      page.evaluate(async () => {
        const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
        const ctx = canvasEl.getContext('2d')!;
        const snapshot = () => {
          const { data } = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
          let hash = 0;
          for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) | 0;
          return hash;
        };
        const hashes: number[] = [];
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          hashes.push(snapshot());
        }
        return new Set(hashes).size === 1;
      });

    expect(await sampleFrozen()).toBe(false); // ~1s of real frames, straddling the 89.5s -> 90s+ crossing

    // Also jump WELL past the legacy boundary (simulating genuinely many
    // real minutes, not just barely over 90s) and confirm play still
    // continues -- proves the fix is a real unbounded-duration change, not
    // a slightly-larger-but-still-finite boundary shift.
    await forceElapsedSeconds(page, 600);
    const ballSpeedFarPastBoundary = await getBallSpeed(page);
    expect(ballSpeedFarPastBoundary).toBeGreaterThan(0);
    expect(await sampleFrozen()).toBe(false);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  // MB-13, ADR-0015 §12: MB-11's physics/update-step crash guard and MB-12's
  // 90s-freeze fix are both engine-level (JourneyCanvas.tsx's onTick
  // try/catch; roomEngine.ts's deriveRoomEngineConfig unbounded
  // durationSeconds), not room-specific -- but "should apply automatically"
  // is a claim, not a fact, until actually re-run against Room 3. Reuses
  // the EXACT same deterministic fault-injection methodology as the
  // original MB-11/MB-12 tests above, just reached via Room 3 instead of
  // Room 2.
  test('MB-11s crash guard and MB-12s 90s-freeze fix both still hold in Room 3 (MB-13 regression check, not assumed)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page); // -> room 3
    await expect(page.getByText('Room 3')).toBeVisible();
    // MB-14: let the play-area growth transition settle first, so this is
    // genuinely proving the fixes hold with the RESIZED (Room 3, wider)
    // play area, not the pre-transition Room-1-sized one.
    await page.waitForTimeout(600);

    // MB-12 check first (non-destructive to the crash guard check below):
    // jump elapsedSeconds past the legacy 90s boundary and confirm the
    // frame is still animating (same pixel-hash methodology as the MB-12
    // test above).
    await forceElapsedSeconds(page, 600);
    const frozen = await page.evaluate(async () => {
      const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
      const ctx = canvasEl.getContext('2d')!;
      const snapshot = () => {
        const { data } = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        let hash = 0;
        for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) | 0;
        return hash;
      };
      const hashes: number[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        hashes.push(snapshot());
      }
      return new Set(hashes).size === 1;
    });
    expect(frozen).toBe(false);

    // MB-11 check: fault-injected physics-step exception must still show
    // the SAME recoverable error overlay, in Room 3 as much as Room 2.
    await forceNextTickThrow(page);
    await page.waitForTimeout(300);

    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close micro break' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator(START_BUTTON)).toBeEnabled();

    expect(pageErrors).toEqual([]);
  });

  // MB-22, ADR-0015 §13 (retirement): the play area is now a FIXED width.
  // Reads the REAL rendered DOM (the container's inline max-width style,
  // set by MicroBreakOverlay.tsx from JOURNEY_PLAY_AREA_MAX_WIDTH_PX, and
  // the canvas's own bounding box, sized by JourneyCanvas.tsx's
  // computeBoardConfig call using the SAME constant) -- this test's job is
  // proving the LIVE browser actually reflects the fixed value, not
  // re-proving arithmetic already covered by orb-journey/tuning.test.ts.
  async function getPlayAreaWidths(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
      const container = canvasEl.parentElement as HTMLElement;
      return {
        containerMaxWidthPx: parseFloat(container.style.maxWidth),
        containerBoxWidth: container.getBoundingClientRect().width,
        canvasBoxWidth: canvasEl.getBoundingClientRect().width,
      };
    });
  }

  // MB-22 (finalized after playtesting, supersedes MB-15's 300px baseline):
  // the play area is a fixed 500px, wider than even the pre-MB-14 480px
  // default, prioritizing gameplay comfort over maximal narrowness --
  // still a clearly bounded, non-full-viewport play area at a common
  // desktop viewport (1440x900). This replaces MB-15's own "under 25%
  // width / over 35% margin" thresholds (calibrated for the retired 300px
  // baseline) with numbers matching the new fixed value, pinned precisely
  // rather than loosely, since there is no formula output left to leave
  // headroom for.
  test('MB-22: at a common desktop viewport, the play area is the fixed 500px baseline, leaving a measurable margin on BOTH sides', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(200);

    const room1 = await getPlayAreaWidths(page);
    const viewportWidth = 1440;

    expect(room1.containerMaxWidthPx).toBe(500);
    expect(room1.containerBoxWidth).toBeCloseTo(500, 0);

    // The margin on EACH side (the play area is horizontally centered,
    // mx-auto) is what actually reads as "dashboard visible" to a user --
    // assert it directly. (1440-500)/2 = 470, ~32.6% of the viewport --
    // matching ADR-0015 §13's own "~33-37% margin per side on common
    // desktop viewports" characterization.
    const marginPerSide = (viewportWidth - room1.containerBoxWidth) / 2;
    expect(marginPerSide).toBeGreaterThan(viewportWidth * 0.3);
    expect(marginPerSide).toBeCloseTo(470, 0);
  });

  // MB-22, ADR-0015 §13 (retirement): the room-index growth formula (MB-14)
  // is removed -- the play area is now IDENTICAL at every room. This test
  // replaces the former "grows monotonically" test with its direct
  // opposite claim, and is the primary non-tautological proof for this
  // task: run against the pre-MB-22 code (git stash), Room 3's width was
  // measurably larger than Room 1's (~551px vs 300px, the old growth
  // formula's own output) -- see the MB-22 report for the captured before
  // values. Against the current code, all three must be byte-identical.
  test('MB-22: play area width is IDENTICAL (500px) across Room 1, 2, and 3 -- no growth', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(200);
    const room1 = await getPlayAreaWidths(page);

    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await page.waitForTimeout(200); // no CSS transition to wait out anymore (MB-22 removed it) -- just settle time
    const room2 = await getPlayAreaWidths(page);

    await forceRoomGoal(page); // -> room 3
    await expect(page.getByText('Room 3')).toBeVisible();
    await page.waitForTimeout(200);
    const room3 = await getPlayAreaWidths(page);

    expect(room1.containerMaxWidthPx).toBe(500);
    expect(room2.containerMaxWidthPx).toBe(500);
    expect(room3.containerMaxWidthPx).toBe(500);
    expect(room1.containerBoxWidth).toBeCloseTo(room2.containerBoxWidth, 0);
    expect(room2.containerBoxWidth).toBeCloseTo(room3.containerBoxWidth, 0);
  });

  // MB-14/MB-17: the "two separately-tuned numbers that could drift apart"
  // class of bug the original task brief flagged -- the container (the
  // bounded region MicroBreakOverlay.tsx sizes) and the canvas it holds
  // (JourneyCanvas.tsx's own computeBoardConfig-driven element) must always
  // agree, not just by construction but as measured live pixels.
  //
  // MB-22 update: with a FIXED 500px width, the height ceiling
  // (`maxHeight: min(70vh, 720px)`) now binds at EVERY room identically --
  // verified empirically (not assumed) at this file's own 1440x900
  // viewport before writing this test: container 500x630, canvas
  // 420x630 (2:3-fitted to the 630px height ceiling), centered with a 40px
  // gap on each side. There is no more "Room 1 fits, Room 2 doesn't"
  // distinction to test (both rooms are now the same fixed width) -- this
  // replaces that room-comparison structure with a single invariant,
  // checked identically at Room 1 AND Room 2: the canvas is never wider
  // than its container (no overflow/clipping) and is horizontally
  // centered within it.
  test('the play-area container and the canvas it holds never drift apart -- canvas never wider than its (fixed 500px) container, horizontally centered, identically at Room 1 and Room 2', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(300);

    async function assertNeverDrifted(roomLabel: string) {
      const widths = await getPlayAreaWidths(page);
      expect(widths.containerMaxWidthPx, `${roomLabel} container max-width`).toBe(500);
      const boxes = await page.evaluate(() => {
        const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
        const container = canvasEl.parentElement as HTMLElement;
        const canvasRect = canvasEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        return {
          canvasLeft: canvasRect.left,
          canvasRight: canvasRect.right,
          containerLeft: containerRect.left,
          containerRight: containerRect.right,
        };
      });
      expect(widths.canvasBoxWidth, `${roomLabel} canvas <= container`).toBeLessThanOrEqual(widths.containerBoxWidth + 0.5);
      expect(boxes.canvasLeft, `${roomLabel} canvas left inside container`).toBeGreaterThanOrEqual(boxes.containerLeft - 0.5);
      expect(boxes.canvasRight, `${roomLabel} canvas right inside container`).toBeLessThanOrEqual(boxes.containerRight + 0.5);
      const leftGap = boxes.canvasLeft - boxes.containerLeft;
      const rightGap = boxes.containerRight - boxes.canvasRight;
      expect(leftGap, `${roomLabel}: canvas is horizontally centered within its container, not pinned to one edge`).toBeCloseTo(rightGap, 0);
    }

    await assertNeverDrifted('Room 1');

    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await page.waitForTimeout(300);
    await assertNeverDrifted('Room 2');
  });

  // MB-22, ADR-0015 §13 (retirement): the fixed 500px baseline exceeds a
  // typical phone's own width (390px here) -- `w-full` (100%) wins at
  // EVERY room identically now, verified empirically at this exact
  // viewport before writing this test (container/canvas both exactly
  // 390px, no letterboxing, at Room 1). This replaces MB-14/MB-15's own
  // "Room 1 lands on the narrow baseline, later rooms reach 100%"
  // room-to-room distinction, which no longer exists once there is no
  // growth: mobile behavior is now identical across every room, not a
  // room-dependent one.
  test('mobile viewport: the play area is 100% of the (narrower) viewport width, identically at Room 1, 2, and 3 -- the fixed 500px baseline always exceeds the phones own width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // portrait phone, same as microBreaksMobileAcceptance.spec.ts
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(200);

    const room1 = await getPlayAreaWidths(page);
    expect(room1.containerMaxWidthPx).toBe(500); // the CSS cap is still the fixed 500px constant...
    expect(room1.canvasBoxWidth).toBeCloseTo(390, 0); // ...but w-full (100%) wins the render, same as it always has once the cap exceeds the viewport
    expect(room1.canvasBoxWidth).toBeGreaterThan(260); // above the MB-15 mobile/touch safety floor -- not over-shrunk

    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await page.waitForTimeout(200);
    const room2 = await getPlayAreaWidths(page);
    expect(room2.canvasBoxWidth).toBeCloseTo(room1.canvasBoxWidth, 0); // identical -- no growth to distinguish rooms anymore

    await forceRoomGoal(page); // -> room 3
    await expect(page.getByText('Room 3')).toBeVisible();
    await page.waitForTimeout(200);
    const room3 = await getPlayAreaWidths(page);
    expect(room3.canvasBoxWidth).toBeCloseTo(room1.canvasBoxWidth, 0);
    expect(room3.containerBoxWidth).toBeLessThanOrEqual(390);

    // No horizontal page overflow -- the dialog/canvas never pushes the
    // document wider than the viewport (a real clipping/overflow check,
    // not just "the canvas element's own reported width is small").
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
  });

  // MB-17, ADR-0015 §13 (correction): proves the canvas's ON-SCREEN
  // rendered box is never a different aspect ratio than its drawing buffer
  // -- the exact mechanism that stretches whatever is drawn in the buffer
  // (including the ball, drawn as a perfect circle via ctx.arc) into an
  // ellipse on screen.
  //
  // Methodological note (corrected during this task -- see the MB-17
  // report): an earlier version of this test read the ball's shape via
  // `ctx.getImageData()` on the canvas itself. That was WRONG: getImageData
  // always reads the drawing BUFFER's own pixels, in the buffer's own
  // coordinate space -- it reflects nothing about how the browser then
  // stretches that buffer onto the screen at paint time (the CSS box vs.
  // buffer-size mismatch this bug is actually about). Proven empirically:
  // that version's assertions kept passing even against the DELIBERATELY
  // REVERTED (still-buggy) code, because getImageData() cannot see a
  // compositing-time stretch at all -- a real non-tautological red flag,
  // caught by re-running the revert-fail check with the FINAL test rather
  // than trusting the first "it failed" result (which, on inspection, had
  // actually failed for the wrong reason -- Room 1 pixel-quantization
  // noise -- and short-circuited before ever reaching the Room 3
  // assertion). The direct getBoundingClientRect() vs canvas.width/height
  // comparison below is what a real display actually shows, is
  // deterministic (no pixel-threshold tuning, no squash/trail contamination
  // risk), and is provably equivalent to "is anything drawn in the buffer,
  // ball included, uniformly scaled or stretched on screen."
  async function getCanvasBufferVsBoxAspect(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return { bufferAspect: canvas.width / canvas.height, boxAspect: rect.width / rect.height };
    });
  }

  test('MB-17: the canvas renders on-screen at the SAME aspect ratio as its drawing buffer at Room 1, and after transitioning to Room 3 -- content (including the ball) is never non-uniformly stretched into an ellipse', async ({
    page,
  }) => {
    // 1440x900: the exact viewport class the MB-17 report's own diagnostic
    // used to reproduce the bug (the 630px `maxHeight: min(70vh, 720px)`
    // ceiling binds before a grown room's width does).
    await page.setViewportSize({ width: 1440, height: 900 });
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(300);

    // Room 1's board (300px, MB-15 baseline) is never height-capped at this
    // viewport (300/BOARD_ASPECT is well under the 630px ceiling), so it
    // structurally can't exhibit this bug -- included as a sanity control,
    // not the primary catch.
    const room1 = await getCanvasBufferVsBoxAspect(page);
    expect(room1.boxAspect / room1.bufferAspect, 'Room 1 box:buffer aspect ratio').toBeCloseTo(1, 1);

    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page); // -> room 3 -- the widest reachable room, where the height ceiling binds hardest
    await expect(page.getByText('Room 3')).toBeVisible();
    await page.waitForTimeout(600); // clear the CSS max-width transition, matching this file's own established settle-wait pattern (MB-14/15)

    // The pre-MB-17 bug was the STEADY-STATE render once the room's width
    // grew past what `maxHeight: min(70vh, 720px)` allows, not a transient
    // mid-animation artifact -- confirmed in the MB-17 report's own
    // diagnostic (the box measured 802px wide against a 420px buffer here,
    // a 1.91x stretch, stable well after the CSS transition completes).
    const room3 = await getCanvasBufferVsBoxAspect(page);
    expect(room3.boxAspect / room3.bufferAspect, 'Room 3 box:buffer aspect ratio, settled').toBeCloseTo(1, 1);
  });

  // MB-17, ADR-0014 §2 (correction); MB-22 (updated): the dim/blur boundary
  // tracks the play area's width -- now a FIXED 500px, not a growing one --
  // outside that boundary, the workspace renders at full clarity.
  test.describe('MB-17/MB-22: dim/blur boundary scoped to the play area (Journey only)', () => {
    test('at Room 1, the dim/blur boundary is present and width-capped at the fixed 500px baseline, and Quick Break keeps its OWN full-viewport dim/blur unchanged (explicit regression guard, not assumed)', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openJourney(page);
      await expect(page.getByText('Room 1')).toBeVisible();
      await page.waitForTimeout(300);

      const boundary = page.getByTestId('journey-play-area-boundary');
      await expect(boundary).toBeVisible();
      const boundaryBox = await boundary.boundingBox();
      expect(boundaryBox).not.toBeNull();
      // MB-22: the new fixed 500px baseline -- the SAME number the canvas
      // container's own max-width uses, not a separately-tuned value.
      expect(boundaryBox!.width).toBeCloseTo(500, 0);

      // The dialog root itself must NOT also carry the uniform full-
      // viewport treatment while Journey's own scoped boundary is active --
      // otherwise "outside the boundary is fully clear" would be false (the
      // uniform wash would still dim everything underneath it).
      const dialogBackdropFilter = await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backdropFilter);
      expect(dialogBackdropFilter === 'none' || dialogBackdropFilter === '').toBe(true);

      // A point clearly OUTSIDE the boundary (near the left edge of a 1440px
      // viewport, far from the centered ~500px band spanning 470-970px) must
      // resolve to an element with NO backdrop-filter and NO dark
      // translucent background -- genuinely full clarity, not just "less
      // dim."
      const outsidePointStyle = await page.evaluate(() => {
        const el = document.elementFromPoint(20, 400);
        if (!el) return null;
        const style = getComputedStyle(el);
        return { backdropFilter: style.backdropFilter, backgroundColor: style.backgroundColor };
      });
      expect(outsidePointStyle).not.toBeNull();
      expect(outsidePointStyle!.backdropFilter === 'none' || outsidePointStyle!.backdropFilter === '').toBe(true);
      expect(outsidePointStyle!.backgroundColor).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\.5\)/);

      // Regression guard, SAME file: Quick Break's dim/blur is untouched --
      // still the uniform full-viewport wash on the dialog root itself, and
      // no Journey-only boundary element exists for this session type.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.click(START_BUTTON);
      await page.getByRole('button', { name: 'Quick Break' }).click();
      await page.waitForTimeout(300);

      const qbDialogBackdropFilter = await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backdropFilter);
      expect(qbDialogBackdropFilter).not.toBe('none');
      expect(qbDialogBackdropFilter).not.toBe('');
      await expect(page.getByTestId('journey-play-area-boundary')).toHaveCount(0);
    });

    // MB-22: with the growth formula removed, the fixed 500px baseline
    // ALWAYS exceeds a phone's own width -- verified empirically (not
    // assumed) at this exact viewport before writing this test: the
    // boundary is exactly 390px (w-full wins) at BOTH Room 1 and Room 2,
    // no room-to-room "narrower then full" transition left to prove (that
    // was MB-14/15's own room-10-convergence substitute test, retired along
    // with the growth formula it demonstrated).
    test('on a narrow mobile viewport, the dim/blur boundary matches the FULL viewport width identically at Room 1 and Room 2 -- the fixed 500px baseline always exceeds the phones own width', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openJourney(page);
      await expect(page.getByText('Room 1')).toBeVisible();
      await page.waitForTimeout(200);

      const room1BoundaryBox = await page.getByTestId('journey-play-area-boundary').boundingBox();
      expect(room1BoundaryBox).not.toBeNull();
      expect(room1BoundaryBox!.width).toBeCloseTo(390, 0);

      await forceRoomGoal(page); // -> room 2
      await expect(page.getByText('Room 2')).toBeVisible();
      await page.waitForTimeout(200);

      const room2BoundaryBox = await page.getByTestId('journey-play-area-boundary').boundingBox();
      expect(room2BoundaryBox).not.toBeNull();
      expect(room2BoundaryBox!.width).toBeCloseTo(390, 0);
    });

    // MB-22, ADR-0014 §2 (updated): the actual regression this task fixes.
    // Pre-fix, Journey's HUD (room/score) was positioned against the FULL
    // VIEWPORT (a sibling of the play-area boundary, top-left, safe-area-
    // anchored) -- MB-17 correctly cleared everything OUTSIDE the boundary
    // to full brightness, which left that HUD sitting on bright dashboard
    // content once MB-17 shipped. Non-tautological proof: run against the
    // pre-fix code (git stash), the HUD's bounding box left edge sat at the
    // dialog's own safe-area inset (near x=16, far outside the
    // boundary's left edge at x=470 on this 1440px viewport) -- see the
    // MB-22 report for the captured out-of-bounds coordinates. Against the
    // current code, the HUD must be FULLY CONTAINED within the boundary's
    // own box.
    test('the Journey HUD (room/score) is fully CONTAINED within the play-area boundarys bounding box -- not floating outside it over the undimmed dashboard', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openJourney(page);
      await expect(page.getByText('Room 1')).toBeVisible();
      await page.waitForTimeout(300);

      const boundaryBox = await page.getByTestId('journey-play-area-boundary').boundingBox();
      const hudBox = await page.getByText('Room 1').locator('..').boundingBox(); // the HUD wrapper div, parent of the "Room 1" span
      expect(boundaryBox).not.toBeNull();
      expect(hudBox).not.toBeNull();

      expect(hudBox!.x, 'HUD left edge >= boundary left edge').toBeGreaterThanOrEqual(boundaryBox!.x - 0.5);
      expect(hudBox!.y, 'HUD top edge >= boundary top edge').toBeGreaterThanOrEqual(boundaryBox!.y - 0.5);
      expect(hudBox!.x + hudBox!.width, 'HUD right edge <= boundary right edge').toBeLessThanOrEqual(boundaryBox!.x + boundaryBox!.width + 0.5);
      expect(hudBox!.y + hudBox!.height, 'HUD bottom edge <= boundary bottom edge').toBeLessThanOrEqual(boundaryBox!.y + boundaryBox!.height + 0.5);
    });
  });

  // MB-22, ADR-0014 §2 (updated): MB-17's own "boundary and container must
  // never desync" invariant, re-proven at the new fixed width. There is no
  // more CSS transition to poll through a timeline (MB-22 removed it --
  // dead code once the width never changes, see MicroBreakOverlay.tsx's own
  // comment) -- this replaces the old multi-timepoint transition-polling
  // loop with a single-snapshot equality check at Room 1, 2, and 3, since
  // both values are driven by the SAME JOURNEY_PLAY_AREA_MAX_WIDTH_PX
  // constant from the SAME React render, with nothing left to animate
  // between.
  test('MB-22: the dim/blur boundary and the canvas container are always exactly the same fixed width (500px), at Room 1, 2, and 3 -- never desynced, with no transition to poll through anymore', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(200);

    async function assertSynced(roomLabel: string) {
      const widths = await page.evaluate(() => {
        const boundary = document.querySelector('[data-testid="journey-play-area-boundary"]') as HTMLElement;
        const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
        const container = canvasEl.parentElement as HTMLElement;
        return { boundaryWidth: boundary.getBoundingClientRect().width, containerWidth: container.getBoundingClientRect().width };
      });
      expect(widths.boundaryWidth, `${roomLabel} boundary width`).toBeCloseTo(500, 0);
      expect(widths.containerWidth, `${roomLabel} container width`).toBeCloseTo(500, 0);
      expect(widths.boundaryWidth, `${roomLabel}: boundary == container`).toBeCloseTo(widths.containerWidth, 0);
    }

    await assertSynced('Room 1');

    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    await page.waitForTimeout(100); // brief settle, no CSS transition to wait out anymore
    await assertSynced('Room 2');

    await forceRoomGoal(page); // -> room 3
    await expect(page.getByText('Room 3')).toBeVisible();
    await page.waitForTimeout(100);
    await assertSynced('Room 3');
  });

  // MB-18, ADR-0015 §3 (correction): real-browser smoke for the two-strike
  // rule. The pure-logic proof (grace preserves combo/speed/orbs; the 2nd
  // miss reaches the SAME full-restart end-state) already lives in
  // roomEngine.test.ts -- this test's job is confirming the real browser
  // wiring (JourneyCanvas.tsx's dev hooks, stepJourney's own state machine)
  // actually reflects that live, not re-proving the math.
  test('MB-18: a full two-miss sequence is visible in a real browser -- 1st floor miss is a grace strike (same room, missCount 1), 2nd fully restarts (missCount back to 0)', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(200);

    expect(await getMissCount(page)).toBe(0);

    // 1st floor miss -- grace.
    await forceFloorMiss(page);
    await page.waitForTimeout(100);
    expect(await getMissCount(page)).toBe(1);
    await expect(page.getByText('Room 1')).toBeVisible(); // still Room 1, dialog still open, no restart yet
    await expect(page.getByRole('dialog')).toBeVisible();

    // 2nd floor miss -- full restart.
    await forceFloorMiss(page);
    await page.waitForTimeout(100);
    expect(await getMissCount(page)).toBe(0); // reset by the full restart
    await expect(page.getByText('Room 1')).toBeVisible(); // still the SAME room -- room-local only, never the whole Journey

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  // MB-18: the grace-miss re-serve must have SOME visible distinction from
  // a normal serve (task brief: "don't leave it silent/indistinguishable").
  // Reuses the existing Jolt reaction primitive (JourneyCanvas.tsx) --
  // proven via the SAME shared trigger state (driftingOrbReactionUntilRef)
  // that Room 2+'s penalty-role drifting-orb catch already uses and already
  // renders correctly (existing coverage). This test's job is proving the
  // grace-miss path actually REACHES that same trigger, not re-proving the
  // Jolt drawing routine itself -- Room 1 has no drifting orbs at all, so
  // if the reaction is active there, a grace miss is the only possible
  // cause (no ambiguity with a real orb catch).
  test('MB-18: the grace-miss re-serve triggers the SAME visible reaction cue Room 2+s penalty-orb catch uses, not a silent teleport', async ({
    page,
  }) => {
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.waitForTimeout(300);

    expect(await isReactionActive(page)).toBe(false); // no reaction active yet -- otherwise the next assertion would be trivially true

    await forceFloorMiss(page);
    await page.waitForTimeout(50); // within the Jolt flash's own window (DRIFTING_ORB_JOLT_FLASH_DURATION_MS, 260ms)

    expect(await getMissCount(page)).toBe(1); // confirms the grace path was actually taken
    expect(await isReactionActive(page)).toBe(true);

    // And it fades -- not a permanently-stuck cue.
    await page.waitForTimeout(400);
    expect(await isReactionActive(page)).toBe(false);
  });

  // MB-18: confirms MB-11's crash guard and MB-12's 90s-freeze fix both
  // still hold once room-local misses go through the NEW two-strike state
  // machine, not just the original single-miss restart path they were
  // originally proven against.
  test('MB-18 regression check: MB-11s crash guard and MB-12s 90s-freeze fix both still hold under the new two-strike miss state machine', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();

    // Push near the legacy 90s boundary, THEN drive a full two-miss cycle
    // (grace, then full restart) across it -- the exact combination that
    // never existed before MB-18 (a room-local restart used to be reached
    // in one miss).
    await forceElapsedSeconds(page, 89.5);
    await forceFloorMiss(page); // grace
    await page.waitForTimeout(50);
    expect(await getMissCount(page)).toBe(1);
    await forceFloorMiss(page); // full restart, crossing the 90s boundary along the way
    await page.waitForTimeout(50);
    expect(await getMissCount(page)).toBe(0);

    const sampleFrozen = () =>
      page.evaluate(async () => {
        const canvasEl = document.querySelector('canvas') as HTMLCanvasElement;
        const ctx = canvasEl.getContext('2d')!;
        const snapshot = () => {
          const { data } = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
          let hash = 0;
          for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) | 0;
          return hash;
        };
        const hashes: number[] = [];
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          hashes.push(snapshot());
        }
        return new Set(hashes).size === 1;
      });
    expect(await sampleFrozen()).toBe(false); // still animating, not frozen

    // Crash guard: force the physics/update-step throw (MB-11) immediately
    // after that same two-miss cycle -- confirms the try/catch coverage
    // wasn't accidentally narrowed by the new missCount branching.
    await forceNextTickThrow(page);
    await page.waitForTimeout(300); // let the next tick actually run and throw
    await expect(page.getByText('Something went wrong with the game')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});

// MB-26, ADR-0015 §15: paddle jump-strike (Room 3+) input coverage --
// room-gating, keyboard (Space, including the accidental-exit guard), and
// touch/pointer (tap vs. drag). These need real browser keyboard/pointer
// event dispatch (jsdom cannot reliably synthesize the button-activation
// behavior Space's guard defends against), same rationale as every other
// canvas-adjacent Journey behavior in this file.
test.describe('MB-26 paddle jump-strike (ADR-0015 §15): room-gating, keyboard, and touch input', () => {
  test('jump input is a structural no-op in Rooms 1-2 (dev-hook trigger), and becomes active once Room 3 is reached', async ({ page }) => {
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();

    expect((await getPaddleJumpState(page)).enabledThisRoom).toBe(false);
    await triggerPaddleJump(page);
    expect((await getPaddleJumpState(page)).active).toBe(false); // Room 1: inert

    await forceRoomGoal(page); // -> room 2
    await expect(page.getByText('Room 2')).toBeVisible();
    expect((await getPaddleJumpState(page)).enabledThisRoom).toBe(false);
    await triggerPaddleJump(page);
    expect((await getPaddleJumpState(page)).active).toBe(false); // Room 2: still inert

    await forceRoomGoal(page); // -> room 3
    await expect(page.getByText('Room 3')).toBeVisible();
    expect((await getPaddleJumpState(page)).enabledThisRoom).toBe(true);
    await triggerPaddleJump(page);
    expect((await getPaddleJumpState(page)).active).toBe(true); // Room 3: active
  });

  test('Space triggers a jump in Room 3, but is a no-op in Room 1 -- the same room-gating the dev hook and touch input both respect', async ({
    page,
  }) => {
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await page.keyboard.press('Space');
    await page.waitForTimeout(50);
    expect((await getPaddleJumpState(page)).active).toBe(false);

    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page);
    await expect(page.getByText('Room 3')).toBeVisible();
    await page.keyboard.press('Space');
    await page.waitForTimeout(50);
    expect((await getPaddleJumpState(page)).active).toBe(true);
  });

  test('cooldown enforced: rapid repeated Space presses do not chain -- the hops own elapsed clock never resets mid-hop from a re-press', async ({
    page,
  }) => {
    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page);
    await expect(page.getByText('Room 3')).toBeVisible();

    await page.keyboard.press('Space');
    await page.waitForTimeout(30);
    const firstState = await getPaddleJumpState(page);
    expect(firstState.active).toBe(true);

    // Rapid re-presses while still airborne -- a naive re-trigger would
    // reset paddleJumpElapsedMs back toward 0 on each press.
    await page.keyboard.press('Space');
    await page.waitForTimeout(20);
    await page.keyboard.press('Space');
    await page.waitForTimeout(20);
    const stateAfterSpam = await getPaddleJumpState(page);
    expect(stateAfterSpam.elapsedMs).toBeGreaterThanOrEqual(firstState.elapsedMs); // kept advancing monotonically, never reset by a re-press
  });

  test('Space never activates the close button while a Journey session is active -- the dialog stays open across repeated presses; Escape (unlike Space) still closes it, proving the dialog COULD have closed', async ({
    page,
  }) => {
    await openJourney(page);
    await expect(page.getByText('Room 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close micro break' })).toBeVisible();

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Space');
    }
    await page.waitForTimeout(50);
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('a quick tap on the canvas triggers a jump in Room 3; a slow drag across the canvas does NOT trigger a jump, and the paddle still moves normally with the drag', async ({
    page,
  }) => {
    await openJourney(page);
    await forceRoomGoal(page);
    await expect(page.getByText('Room 2')).toBeVisible();
    await forceRoomGoal(page);
    await expect(page.getByText('Room 3')).toBeVisible();

    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas bounding box -- cannot drive synthetic pointer input');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Quick tap: down and up at (almost) the same point, no delay.
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(50);
    expect((await getPaddleJumpState(page)).active).toBe(true);

    // Let the hop AND its cooldown fully clear before the drag check --
    // riseMs+fallMs (280ms) + cooldownMs (600ms), generous margin.
    await page.waitForTimeout(1200);
    expect((await getPaddleJumpState(page)).cooldownRemainingMs).toBe(0);

    const paddleFractionBeforeDrag = await page.evaluate(
      () => (window as unknown as { __orbJourneyDevGetPaddleXFraction?: () => number }).__orbJourneyDevGetPaddleXFraction?.() ?? 0.5,
    );

    // Slow drag: down, then several incremental moves across a real
    // distance, each separated by a real delay -- "even one that starts
    // slowly," per the task brief -- then up.
    const dragStartX = box.x + box.width * 0.15;
    await page.mouse.move(dragStartX, centerY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
      await page.waitForTimeout(60);
      await page.mouse.move(dragStartX + step * (box.width * 0.12), centerY);
    }
    await page.mouse.up();
    await page.waitForTimeout(50);

    // The drag must NOT have re-triggered a jump (no fresh cooldown/active state).
    const stateAfterDrag = await getPaddleJumpState(page);
    expect(stateAfterDrag.active).toBe(false);
    expect(stateAfterDrag.cooldownRemainingMs).toBe(0);

    // And drag-to-move itself is genuinely unaffected -- the paddle tracked
    // the drag's real end position.
    const paddleFractionAfterDrag = await page.evaluate(
      () => (window as unknown as { __orbJourneyDevGetPaddleXFraction?: () => number }).__orbJourneyDevGetPaddleXFraction?.() ?? 0.5,
    );
    expect(paddleFractionAfterDrag).toBeGreaterThan(paddleFractionBeforeDrag + 0.2); // moved meaningfully rightward with the drag
  });
});
