import { describe, expect, it } from 'vitest';
import { BOARD_MIN_WIDTH_PX } from '../micro-breaks/tuning';
import {
  getJourneyPlayAreaMaxWidthPx,
  getJourneyPlayAreaWidthRatio,
  JOURNEY_PLAY_AREA_BASELINE_RATIO,
  JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX,
  JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX,
  JOURNEY_PLAY_AREA_MIN_WIDTH_PX,
  JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX,
} from './tuning';

// MB-14, ADR-0015 §13; baseline corrected by MB-15 (coordinator error --
// the original ~480px baseline was never actually "narrow," see the MB-15
// report). The pure play-area growth formula. Covers exactly the
// acceptance criteria the task briefs name: room 1 baseline matches the
// NEW genuinely-narrow width; monotonically increasing; clamped at 1.0;
// reaches (not just "eventually approaches") 1.0 at/around room 10, per the
// PO's explicit "gradual, ~room 10" direction -- UNCHANGED by MB-15, a
// regression guard proving the ending endpoint didn't drift while the
// starting endpoint moved.
describe('orb-journey tuning: getJourneyPlayAreaWidthRatio (MB-14, ADR-0015 §13; baseline corrected MB-15)', () => {
  it('room 1s ratio, multiplied back out by the reference width, reproduces the NEW genuinely-narrow baseline (JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX, 300px) exactly -- NOT the old ~480px MB-14 value', () => {
    const room1WidthPx = getJourneyPlayAreaWidthRatio(1) * JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX;
    expect(room1WidthPx).toBeCloseTo(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX, 6);
    expect(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX).toBe(300);
    expect(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX).not.toBe(480); // MB-15's whole point -- the old value must be gone, not just relabeled
    expect(getJourneyPlayAreaWidthRatio(1)).toBe(JOURNEY_PLAY_AREA_BASELINE_RATIO);
  });

  it('is monotonically increasing across rooms 1 through 12 (past the full-screen room, to also prove it never DECREASES after clamping)', () => {
    const ratios = Array.from({ length: 12 }, (_, i) => getJourneyPlayAreaWidthRatio(i + 1));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1]);
    }
    // Strictly increasing (not just non-decreasing) UP TO the clamp point --
    // a flat formula that never actually grows would trivially pass a bare
    // "non-decreasing" check.
    expect(ratios[JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX - 2]).toBeGreaterThan(ratios[0]);
  });

  it('reaches EXACTLY 1.0 at the PO-specified target room index (10), not before and not meaningfully after', () => {
    expect(getJourneyPlayAreaWidthRatio(JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX)).toBe(1);
    // Not before: room 9 must still be measurably short of full-screen --
    // otherwise clamping could be hiding an accidentally-too-steep step
    // that reaches 1.0 early while still reporting "10" as the constant.
    expect(getJourneyPlayAreaWidthRatio(JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX - 1)).toBeLessThan(1);
  });

  it('is clamped at 1.0 for every room at or beyond the target -- never exceeds it', () => {
    for (const roomIndex of [10, 11, 15, 50]) {
      expect(getJourneyPlayAreaWidthRatio(roomIndex)).toBe(1);
    }
  });

  it('never goes below the room-1 baseline, even for a degenerate roomIndex of 0 or negative', () => {
    expect(getJourneyPlayAreaWidthRatio(0)).toBe(JOURNEY_PLAY_AREA_BASELINE_RATIO);
    expect(getJourneyPlayAreaWidthRatio(-5)).toBe(JOURNEY_PLAY_AREA_BASELINE_RATIO);
  });

  it('growth is LINEAR (constant step) between room 1 and the full-screen target -- not some other curve shape', () => {
    const step1to2 = getJourneyPlayAreaWidthRatio(2) - getJourneyPlayAreaWidthRatio(1);
    const step5to6 = getJourneyPlayAreaWidthRatio(6) - getJourneyPlayAreaWidthRatio(5);
    expect(step5to6).toBeCloseTo(step1to2, 10);
  });

  // MB-15 regression guard: this task ONLY moves the starting endpoint. If
  // JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX or JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX
  // had been accidentally touched alongside the baseline, room 10's PIXEL
  // value (not just its ratio, already covered above) would drift too --
  // this pins the actual pixel number MB-14 shipped.
  it('room 10s pixel value is EXACTLY 2560 -- the MB-14 ending endpoint, unmoved by this baseline-only correction', () => {
    expect(JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX).toBe(2560);
    expect(JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX).toBe(10);
    expect(getJourneyPlayAreaMaxWidthPx(JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX)).toBeCloseTo(2560, 6);
  });
});

describe('orb-journey tuning: getJourneyPlayAreaMaxWidthPx (MB-14) -- the single value feeding BOTH the container CSS and computeBoardConfigs override', () => {
  it('is exactly the ratio times the reference width, for every room -- one derivation, not a separately-tuned pixel table', () => {
    for (const roomIndex of [1, 2, 3, 7, 10, 20]) {
      expect(getJourneyPlayAreaMaxWidthPx(roomIndex)).toBeCloseTo(getJourneyPlayAreaWidthRatio(roomIndex) * JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX, 6);
    }
  });

  it('room 3 (the last authored room, MB-13) is measurably wider than room 1, but still well short of full-screen -- growth is gradual, not front-loaded', () => {
    const room1Px = getJourneyPlayAreaMaxWidthPx(1);
    const room3Px = getJourneyPlayAreaMaxWidthPx(3);
    expect(room3Px).toBeGreaterThan(room1Px);
    expect(room3Px).toBeLessThan(JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX * 0.5); // nowhere near full-screen yet by room 3
  });
});

// MB-15: the new mobile/touch safety floor. Task brief explicitly asked
// whether this fights with, or is redundant given, MB-14's existing
// `min(100%, cap)` mobile composition -- verified below, not assumed.
describe('orb-journey tuning: JOURNEY_PLAY_AREA_MIN_WIDTH_PX (MB-15 mobile/touch safety floor)', () => {
  it('is positioned strictly BELOW the new baseline, and strictly ABOVE the shared engine floor (BOARD_MIN_WIDTH_PX) -- the only coherent range for a floor that must not override Room 1s own narrow starting point', () => {
    expect(JOURNEY_PLAY_AREA_MIN_WIDTH_PX).toBeLessThan(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX);
    expect(JOURNEY_PLAY_AREA_MIN_WIDTH_PX).toBeGreaterThan(BOARD_MIN_WIDTH_PX);
  });

  it('getJourneyPlayAreaMaxWidthPx NEVER returns a value below the floor, for every room including degenerate ones', () => {
    for (const roomIndex of [-5, 0, 1, 2, 3, 5, 10, 50]) {
      expect(getJourneyPlayAreaMaxWidthPx(roomIndex)).toBeGreaterThanOrEqual(JOURNEY_PLAY_AREA_MIN_WIDTH_PX);
    }
  });

  // Honest redundancy finding, proven rather than asserted in the report
  // prose alone: since the formula is monotonic non-decreasing starting AT
  // the baseline (already proven above), and the baseline itself already
  // exceeds the floor, the floor can be REMOVED from
  // getJourneyPlayAreaMaxWidthPx entirely without changing its output for
  // any room -- i.e. it never currently binds. This test would FAIL if a
  // future edit ever made that untrue (e.g. lowering the baseline below the
  // floor), which is exactly the safety net this constant exists to be.
  it('the floor is currently NON-BINDING for every room -- the unfloored ratio-based value already meets it on its own (confirms the floor is a dormant safety net today, not a live behavior change)', () => {
    for (const roomIndex of [1, 2, 3, 5, 10]) {
      const unflooredPx = getJourneyPlayAreaWidthRatio(roomIndex) * JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX;
      expect(unflooredPx).toBeGreaterThanOrEqual(JOURNEY_PLAY_AREA_MIN_WIDTH_PX);
    }
  });
});
