import { describe, expect, it } from 'vitest';
import { BOARD_MAX_WIDTH_PX } from '../micro-breaks/tuning';
import {
  getJourneyPlayAreaMaxWidthPx,
  getJourneyPlayAreaWidthRatio,
  JOURNEY_PLAY_AREA_BASELINE_RATIO,
  JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX,
  JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX,
} from './tuning';

// MB-14, ADR-0015 §13: the pure play-area growth formula. Covers exactly
// the acceptance criteria the task brief names: room 1 baseline matches
// today's current fixed width; monotonically increasing; clamped at 1.0;
// reaches (not just "eventually approaches") 1.0 at/around room 10, per the
// PO's explicit "gradual, ~room 10" direction.
describe('orb-journey tuning: getJourneyPlayAreaWidthRatio (MB-14, ADR-0015 §13)', () => {
  it('room 1s ratio, multiplied back out by the reference width, reproduces todays EXACT fixed 480px cap (BOARD_MAX_WIDTH_PX) -- not an approximation', () => {
    const room1WidthPx = getJourneyPlayAreaWidthRatio(1) * JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX;
    expect(room1WidthPx).toBeCloseTo(BOARD_MAX_WIDTH_PX, 6);
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
