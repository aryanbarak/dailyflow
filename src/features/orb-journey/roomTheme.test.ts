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
import { computeObstaclePulseAlpha, computeRoomTransitionFlashAlpha, resolveRoomThemeColors } from './roomTheme';
import { getObstacleBreakParticleCount } from './tuning';

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
