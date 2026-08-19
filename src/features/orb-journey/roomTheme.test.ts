// @vitest-environment jsdom
//
// ADR-0015 §5: room theming is abstract and design-token-driven ONLY --
// never real task titles, event data, or amounts. This preserves the
// existing "game never reads workspace data" trust boundary (ADR-0014 §1).
//
// Two independent proofs, deliberately not just one:
// 1. STATIC (source-verification): roomTheme.ts's own import statements
//    never reference any workspace/task/calendar/finance/journal
//    data-fetching module. This is the stronger guarantee -- it holds
//    regardless of which code path a test happens to exercise, unlike a
//    runtime spy which only proves "wasn't called THIS run."
// 2. RUNTIME: resolving colors never triggers a network request. Actually
//    drawing (drawRoomTheme/drawFocusTasksTheme, in the SAME file with the
//    SAME closed import list) needs a real canvas 2D context -- jsdom has
//    none at all (see this project's "green jsdom proves nothing about
//    canvas rendering" lesson) -- so that half of the proof is structural
//    (proof #1: nothing importable to call) plus the real-browser Journey
//    smoke test (e2e/orbJourney.spec.ts) actually rendering a room.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeAbsorbPulseAlpha,
  computeJoltFlashIntensity,
  computeJoltShakeOffset,
  computeObstaclePulseAlpha,
  computeRoomTransitionFlashAlpha,
  resolveRoomThemeColors,
} from './roomTheme';
import { getDriftingOrbAbsorbParticleCount, getDriftingOrbJoltParticleCount, getObstacleBreakParticleCount } from './tuning';

const roomThemeSource = readFileSync(path.resolve(process.cwd(), 'src', 'features', 'orb-journey', 'roomTheme.ts'), 'utf-8');

describe('roomTheme: static import boundary (ADR-0015 §5)', () => {
  it('imports nothing from any workspace/task/calendar/finance/journal data module', () => {
    const disallowedPatterns = [
      /from ['"].*tasksService['"]/,
      /from ['"].*useTasks['"]/,
      /from ['"].*financeService['"]/,
      /from ['"].*useFinance['"]/,
      /from ['"].*calendarService['"]/,
      /from ['"].*journalService['"]/,
      /from ['"].*\/hooks\/use[A-Z]/, // any app data hook (useTasks, useFinance, useHabits, etc.)
      /from ['"].*supabase['"]/i,
      /from ['"]@\/features\/tasks/,
      /from ['"]@\/features\/finance/,
      /from ['"]@\/features\/calendar/,
      /from ['"]@\/features\/journal/,
    ];
    for (const pattern of disallowedPatterns) {
      expect(roomThemeSource, `roomTheme.ts must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it('imports ONLY from colorNormalization.ts and roomEngine.ts -- a small, closed, auditable import list', () => {
    const importLines = roomThemeSource.match(/^import .+$/gm) ?? [];
    expect(importLines.length).toBeGreaterThan(0);
    for (const line of importLines) {
      expect(line, line).toMatch(/colorNormalization|roomEngine/);
    }
  });
});

describe('roomTheme: computeRoomTransitionFlashAlpha (MB-06 -- proves the transition eases in AND out, not a hard cut)', () => {
  it('starts and ends at zero alpha -- no instant pop at transition entry, nothing left over at transition exit', () => {
    expect(computeRoomTransitionFlashAlpha(0, 500, 0.35)).toBe(0);
    expect(computeRoomTransitionFlashAlpha(500, 500, 0.35)).toBeCloseTo(0, 5);
  });

  it('reaches the configured peak alpha at the midpoint, not before', () => {
    expect(computeRoomTransitionFlashAlpha(250, 500, 0.35)).toBeCloseTo(0.35, 5);
    // Quarter-way through, still well short of peak -- proves this is a
    // curve, not an instant jump-to-peak-then-linear-decay shape.
    expect(computeRoomTransitionFlashAlpha(125, 500, 0.35)).toBeLessThan(0.35 * 0.8);
    expect(computeRoomTransitionFlashAlpha(125, 500, 0.35)).toBeGreaterThan(0);
  });

  it('is monotonically increasing on the way in and monotonically decreasing on the way out (a real ease, not a step)', () => {
    const samplesIn = [0, 50, 100, 150, 200, 250].map(ms => computeRoomTransitionFlashAlpha(ms, 500, 0.35));
    for (let i = 1; i < samplesIn.length; i++) expect(samplesIn[i]).toBeGreaterThan(samplesIn[i - 1]);

    const samplesOut = [250, 300, 350, 400, 450, 500].map(ms => computeRoomTransitionFlashAlpha(ms, 500, 0.35));
    for (let i = 1; i < samplesOut.length; i++) expect(samplesOut[i]).toBeLessThan(samplesOut[i - 1]);
  });
});

describe('roomTheme: computeObstaclePulseAlpha (MB-07, ADR-0015 §10 -- the breakable-vs-solid visual tell)', () => {
  it('under normal motion, oscillates over time (not a static value) -- proves this is an animated pulse, not a fixed border', () => {
    const samples = [0, 100, 200, 300, 400, 500].map(ms => computeObstaclePulseAlpha(ms, false));
    const distinctValues = new Set(samples.map(v => v.toFixed(3)));
    expect(distinctValues.size).toBeGreaterThan(1);
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('under reduced motion, is a FIXED value regardless of time -- the pulse animation itself is suppressed, matching this project\'s reduced-motion convention', () => {
    const samples = [0, 100, 200, 300, 400, 500].map(ms => computeObstaclePulseAlpha(ms, true));
    expect(new Set(samples).size).toBe(1);
    // Still a real, non-zero value -- the obstacle must stay visually
    // distinguishable (ADR-0015 §10's fairness requirement) EVEN under
    // reduced motion, just without animating.
    expect(samples[0]).toBeGreaterThan(0);
  });
});

describe('roomTheme: computeJoltFlashIntensity (MB-08, ADR-0015 §11 -- Haste "sharp double-flash: bright-dim-bright")', () => {
  it('is bright at the start, dims to zero at the midpoint, and is bright again at the end -- a dip shape, not a fade', () => {
    expect(computeJoltFlashIntensity(0, 260)).toBeCloseTo(1, 5);
    expect(computeJoltFlashIntensity(130, 260)).toBeCloseTo(0, 5);
    expect(computeJoltFlashIntensity(260, 260)).toBeCloseTo(1, 5);
  });

  it('stays within [0, 1] and is symmetric around the midpoint', () => {
    const samples = [0, 40, 80, 130, 180, 220, 260].map(ms => computeJoltFlashIntensity(ms, 260));
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(computeJoltFlashIntensity(80, 260)).toBeCloseTo(computeJoltFlashIntensity(180, 260), 5);
  });
});

describe('roomTheme: computeAbsorbPulseAlpha (MB-08, ADR-0015 §11 -- Calm "single smooth brightening pulse")', () => {
  it('starts at the configured peak and fades smoothly/monotonically to zero -- a DIFFERENT shape from Jolts dip curve, not just a different color', () => {
    const peak = 0.5;
    expect(computeAbsorbPulseAlpha(0, 260, peak)).toBeCloseTo(peak, 5);
    expect(computeAbsorbPulseAlpha(260, 260, peak)).toBeCloseTo(0, 5);
    const samples = [0, 50, 100, 150, 200, 260].map(ms => computeAbsorbPulseAlpha(ms, 260, peak));
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]); // monotonic fade, no mid-dip
  });
});

describe('roomTheme/tuning: the flash/pulse color cue is NEVER reduced-motion-gated -- neither function even accepts a reducedMotion parameter, so a real, non-zero cue always renders for both roles (ADR-0015 §11)', () => {
  it('computeJoltFlashIntensity and computeAbsorbPulseAlpha both produce a real, non-zero value mid-reaction, with no reducedMotion input possible', () => {
    expect(computeJoltFlashIntensity(60, 260)).toBeGreaterThan(0);
    expect(computeAbsorbPulseAlpha(60, 260, 0.5)).toBeGreaterThan(0);
    // Structural: neither function's signature has room for a reducedMotion
    // argument (2 and 3 params respectively) -- confirmed via arity, since
    // TypeScript's own type erasure means this is the only runtime-checkable
    // proxy for "this can't be gated by a parameter it doesn't accept."
    expect(computeJoltFlashIntensity).toHaveLength(2);
    expect(computeAbsorbPulseAlpha).toHaveLength(3);
  });
});

describe('roomTheme: computeJoltShakeOffset (MB-08, ADR-0015 §11 -- Haste "small, bounded, short-duration shake")', () => {
  it('is bounded by magnitudePx at every point in the window, under normal motion', () => {
    const magnitude = 4;
    for (let elapsedMs = 0; elapsedMs <= 220; elapsedMs += 20) {
      const { dx, dy } = computeJoltShakeOffset(1000 + elapsedMs, elapsedMs, 220, magnitude, false);
      expect(Math.abs(dx)).toBeLessThanOrEqual(magnitude + 1e-9);
      expect(Math.abs(dy)).toBeLessThanOrEqual(magnitude + 1e-9);
    }
  });

  it('decays toward zero as the window elapses (bounded AND short-duration, not a constant-amplitude jitter)', () => {
    const early = computeJoltShakeOffset(1000, 5, 220, 4, false);
    const late = computeJoltShakeOffset(1000, 215, 220, 4, false);
    expect(Math.hypot(late.dx, late.dy)).toBeLessThan(Math.hypot(early.dx, early.dy));
  });

  it('is ALWAYS {0,0} under reduced motion, regardless of elapsed time or magnitude -- the nuanced reduced-motion split: shake (motion) is suppressed, unlike the flash/pulse above', () => {
    for (const elapsedMs of [0, 50, 110, 219]) {
      const offset = computeJoltShakeOffset(1000 + elapsedMs, elapsedMs, 220, 4, true);
      expect(offset).toEqual({ dx: 0, dy: 0 });
    }
  });
});

describe('roomTheme/tuning: drifting-orb reaction particle bursts are reduced-motion-gated for BOTH roles (ADR-0015 §11)', () => {
  it('getDriftingOrbAbsorbParticleCount and getDriftingOrbJoltParticleCount both return 0 under reduced motion, and a real positive count otherwise', () => {
    expect(getDriftingOrbAbsorbParticleCount(true)).toBe(0);
    expect(getDriftingOrbAbsorbParticleCount(false)).toBeGreaterThan(0);
    expect(getDriftingOrbJoltParticleCount(true)).toBe(0);
    expect(getDriftingOrbJoltParticleCount(false)).toBeGreaterThan(0);
  });
});

describe('roomTheme/tuning: obstacle break VFX is reduced-motion-gated, but obstacle REMOVAL never is (ADR-0015 §10)', () => {
  it('getObstacleBreakParticleCount returns 0 under reduced motion, and a real positive count otherwise', () => {
    expect(getObstacleBreakParticleCount(true)).toBe(0);
    expect(getObstacleBreakParticleCount(false)).toBeGreaterThan(0);
  });

  it('obstacle-breaking itself (pongEngine.ts/roomEngine.ts) takes no reducedMotion parameter anywhere -- structurally, the removal cannot be gated by it (the burst above is the ONLY reduced-motion-aware part of this feature)', () => {
    const pongEngineSource = readFileSync(
      path.resolve(process.cwd(), 'src', 'features', 'micro-breaks', 'engine', 'pongEngine.ts'),
      'utf-8',
    );
    const roomEngineSource = readFileSync(path.resolve(process.cwd(), 'src', 'features', 'orb-journey', 'roomEngine.ts'), 'utf-8');
    expect(pongEngineSource).not.toMatch(/reducedMotion/i);
    expect(roomEngineSource).not.toMatch(/reducedMotion/i);
  });
});

describe('roomTheme: runtime boundary', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    document.documentElement.style.setProperty('--flow-primary', '#7C4DFF');
    document.documentElement.style.setProperty('--flow-surface-2', '#0F1128');
    document.documentElement.style.setProperty('--flow-border-soft', 'rgba(112, 120, 180, 0.22)');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('style');
  });

  it('resolving theme colors (the only part testable without a real canvas -- jsdom has no 2D context, see this project\'s own "green jsdom proves nothing about canvas" lesson) never calls fetch', () => {
    const colors = resolveRoomThemeColors('focus-tasks');
    expect(colors.accent(0.5)).toBeTruthy();
    expect(colors.cardFill(0.5)).toBeTruthy();
    expect(colors.cardBorder(0.5)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
