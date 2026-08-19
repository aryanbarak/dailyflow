// MB-05, ADR-0015 §4/§7: Orb Journey feel-tuning constants, gathered in one
// file (mirrors the convention established by micro-breaks/tuning.ts).
// PO-approved-shape defaults, not independently validated against real
// playtesting -- flagged in the MB-05 report as a judgment call, same as
// MB-03's tuning.ts was.

// ── Room goal (ADR-0015 §2/§7: ricochet-only, ~15-25s to complete) ──────
/** Room 1's goal: reach this many consecutive hits (combo) to clear it. */
export const ROOM_1_GOAL_COMBO = 8;
/** Each room index beyond 1 adds this many hits to the goal -- ADR-0015 §4:
 *  "room 6 is harder than room 1," room-index-only difficulty. */
export const ROOM_GOAL_COMBO_STEP_PER_ROOM = 4;

// ── Room difficulty scaling (ADR-0015 §4: room-index ONLY, no adaptive
//    performance correction this slice) ──────────────────────────────────
// MB-06: widened from 0.08/0.04 after PO manual QA on MB-05 ("hardly felt
// different, but I expected that") -- ADR-0015 §4 wants room 2 "somewhat"
// harder, not imperceptible. This only changes these two constants' values;
// the engine's own hard ceilings (maxSpeed clamp, maxBounceAngleRad staying
// well under 90 degrees -- ADR-0014 §4) are untouched, since
// deriveRoomEngineConfig never scales maxBounceAngleRad and stepPong's
// Math.min(..., config.maxSpeed) clamp is structural, not a tuning constant.
/** Multiplies baseSpeed (and maxSpeed, proportionally) per room index beyond
 *  1 -- combines with the per-hit speedRampPerHit that already escalates
 *  difficulty WITHIN a room, so this only needs to be a modest per-room
 *  step, not a steep ramp on its own. */
export const ROOM_DIFFICULTY_SPEED_STEP = 0.22;
/** Shrinks paddle width per room index beyond 1, floored at
 *  ROOM_MIN_PADDLE_WIDTH_RATIO so late rooms stay legitimately playable. */
export const ROOM_DIFFICULTY_PADDLE_SHRINK_STEP = 0.12;
export const ROOM_MIN_PADDLE_WIDTH_RATIO = 0.55; // of the base paddle width

// ── Room transition (ADR-0015 §2: short, reduced-motion-aware, no reload) ─
export const ROOM_TRANSITION_SECONDS = 0.5;
export const ROOM_TRANSITION_SECONDS_REDUCED_MOTION = 0; // instant, per Build 4's brief
/** MB-06: peak alpha of the room-transition accent flash -- named here
 *  (was an inline magic number in JourneyCanvas.tsx) so the whole transition
 *  "recipe" lives in one place. */
export const ROOM_TRANSITION_FLASH_PEAK_ALPHA = 0.35;

// ── Breakable obstacles (ADR-0015 §10 amendment, MB-07 -- Room 2 only) ──
/** Obstacle width as a fraction of board width. */
export const OBSTACLE_WIDTH_RATIO = 0.42;
/** Obstacle height as a fraction of board height. */
export const OBSTACLE_HEIGHT_RATIO = 0.055;
/** Obstacle top edge, as a fraction of board height -- clear of the
 *  decorative Focus/Tasks background cards (roughly the top half of the
 *  board) and well above the paddle band. */
export const OBSTACLE_Y_RATIO = 0.6;
/** Combo required, AT THE MOMENT OF CONTACT, to break a breakable obstacle
 *  -- a skill reward, not a default interaction (ADR-0015 §10). */
export const OBSTACLE_COMBO_THRESHOLD_TO_BREAK = 3;
/** "Stronger-than-normal" break VFX vs. a plain paddle hit's
 *  PARTICLE_COUNT_PER_HIT (6, in micro-breaks/tuning.ts). */
export const OBSTACLE_BREAK_PARTICLE_COUNT = 18;
/** ADR-0015 §10: the break VFX burst is suppressed under reduced motion --
 *  the obstacle REMOVAL itself is not (that's gameplay, not decoration; see
 *  roomEngine.ts's pongEngine integration, which has no reduced-motion
 *  awareness at all -- correctly, since it's a pure physics/state concern). */
export function getObstacleBreakParticleCount(reducedMotion: boolean): number {
  return reducedMotion ? 0 : OBSTACLE_BREAK_PARTICLE_COUNT;
}
