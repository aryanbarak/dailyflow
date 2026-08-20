import { describe, expect, it } from 'vitest';
import { BOARD_MIN_WIDTH_PX } from '../micro-breaks/tuning';
import { JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX, JOURNEY_PLAY_AREA_MAX_WIDTH_PX, JOURNEY_PLAY_AREA_MIN_WIDTH_PX } from './tuning';

// MB-22, ADR-0015 §13 (retirement): the room-index growth formula (MB-14,
// baseline corrected by MB-15) is REMOVED, not just unused -- per real
// playtesting, the PO found growing the play area room-to-room read as
// visually disorganized rather than escalating. The play area is now a
// single FIXED width, identical for every Journey room -- these tests
// replace tuning.test.ts's former growth-formula suite (room 1 baseline,
// monotonic growth, room-10 clamp, linear step) with a single, much
// smaller regression surface: the constant itself, and the still-relevant
// mobile/touch safety floor.
describe('orb-journey tuning: JOURNEY_PLAY_AREA_MAX_WIDTH_PX (MB-22, fixed play area, ADR-0015 §13 retirement)', () => {
  it('is the new PO-finalized baseline, 500px -- not MB-15s 300px, and not the mid-task 400px draft', () => {
    expect(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX).toBe(500);
    expect(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX).not.toBe(300);
    expect(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX).not.toBe(400);
    expect(JOURNEY_PLAY_AREA_MAX_WIDTH_PX).toBe(500);
  });

  it('is a plain constant, not a function -- there is no room-index parameter to call it with (the growth formula this used to wrap is gone, not just unreachable)', () => {
    expect(typeof JOURNEY_PLAY_AREA_MAX_WIDTH_PX).toBe('number');
  });
});

// MB-15: the mobile/touch safety floor -- still relevant at the new,
// larger baseline. Task brief explicitly asked this to be RE-verified (not
// assumed) rather than carried over unexamined now that the baseline moved.
describe('orb-journey tuning: JOURNEY_PLAY_AREA_MIN_WIDTH_PX (MB-15 mobile/touch safety floor, re-verified at the MB-22 baseline)', () => {
  it('is positioned strictly BELOW the new 500px baseline, and strictly ABOVE the shared engine floor (BOARD_MIN_WIDTH_PX)', () => {
    expect(JOURNEY_PLAY_AREA_MIN_WIDTH_PX).toBeLessThan(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX);
    expect(JOURNEY_PLAY_AREA_MIN_WIDTH_PX).toBeGreaterThan(BOARD_MIN_WIDTH_PX);
  });

  it('the floor is confirmed NON-BINDING at the new baseline -- JOURNEY_PLAY_AREA_MAX_WIDTH_PX equals the baseline itself, not the (lower) floor', () => {
    // If the floor ever bound, Math.max would return JOURNEY_PLAY_AREA_MIN_WIDTH_PX
    // instead of the baseline -- this fails the instant a future edit drops
    // the baseline below the floor, exactly the safety net this constant
    // exists to be (same reasoning MB-15 originally established, re-run
    // here rather than assumed to still hold at the new, larger value).
    expect(JOURNEY_PLAY_AREA_MAX_WIDTH_PX).toBe(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX);
    expect(JOURNEY_PLAY_AREA_MAX_WIDTH_PX).toBeGreaterThan(JOURNEY_PLAY_AREA_MIN_WIDTH_PX);
  });
});
