// MB-05, ADR-0015 §4/§7: Orb Journey feel-tuning constants, gathered in one
// file (mirrors the convention established by micro-breaks/tuning.ts).
// PO-approved-shape defaults, not independently validated against real
// playtesting -- flagged in the MB-05 report as a judgment call, same as
// MB-03's tuning.ts was.

// ── Fixed play-area width (ADR-0015 §13, MB-22, Journey-only) ───────────
// RETIRED (MB-22, PO decision, post-playtesting): the room-index growth
// formula (MB-14), its room-10 full-screen target, and the reference-
// viewport-ratio mechanism MB-15 refined are all REMOVED, not just unused
// -- see ADR-0015 §13's own retirement note for the product reasoning
// (growing the frame read as visually disorganized, not as escalating
// progression; room-to-room progression is already fully carried by theme/
// difficulty/spawn-cadence signals). The play area is now a single FIXED
// width, identical for every Journey room.
//
// Baseline history: MB-15 calibrated 300px for "dashboard clearly visible
// on both sides." A first MB-22 draft proposed 400px as a balance. After
// actually playing at that comfort level, the PO settled on 500px -- wider
// than even the original pre-MB-14 480px default, explicitly prioritizing
// comfortable gameplay over maximal narrowness. Still comfortably above
// BOARD_MIN_WIDTH_PX (240, micro-breaks/tuning.ts's own absolute
// engine-level floor for board legibility).
export const JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX = 500;

// MB-15: an independent absolute pixel floor -- "mobile/touch safety" --
// distinct from BOARD_MIN_WIDTH_PX (the shared physics engine's own hard
// floor, 240px, used by Quick Break too). MB-22: re-verified (not assumed)
// that this floor is STILL non-binding at the new, larger 500px baseline --
// trivially true now, since the baseline itself only ever grew (300 -> 500)
// while this floor didn't move, so if it never bound at 300 it structurally
// cannot bind at 500 either. Kept as a genuine safety net (same
// Math.max-clamp pattern computeBoardConfig's own BOARD_MIN_WIDTH_PX clamp
// already uses): it protects against a FUTURE baseline edit accidentally
// pushing the play area below a comfortable touch-target width without
// anyone noticing.
export const JOURNEY_PLAY_AREA_MIN_WIDTH_PX = 260;

/** The play-area max-width in PIXELS, identical for every Journey room --
 *  the SINGLE value fed to BOTH the play-area boundary/canvas container's
 *  CSS max-width (MicroBreakOverlay.tsx) and computeBoardConfig's
 *  maxWidthPx override (JourneyCanvas.tsx), same "one computed value, not
 *  two separately-tuned numbers" invariant MB-14 originally established --
 *  now trivially true, since there is no per-room input left to drift.
 *  MB-22: a plain CONSTANT, not a function of roomIndex -- the growth
 *  formula this used to call is removed, not just unused; every call site
 *  below was updated to read this value directly instead of invoking a
 *  per-room lookup. */
export const JOURNEY_PLAY_AREA_MAX_WIDTH_PX = Math.max(JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX, JOURNEY_PLAY_AREA_MIN_WIDTH_PX);

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

// ── Drifting speed-orbs (ADR-0015 §11 amendment, MB-08 -- Room 2 only) ──
export const DRIFTING_ORB_SPAWN_INTERVAL_MS = 4000;
export const DRIFTING_ORB_DRIFT_SPEED_PX_PER_SECOND = 70;
/** Orb radius as a fraction of board width -- scales proportionally like
 *  ball/paddle sizing, never a fixed px value. */
export const DRIFTING_ORB_RADIUS_RATIO = 0.03;
// MB-10, ADR-0015 §11 (revision): post-MB-09 playtesting flipped the
// reward/penalty speed mapping -- speeding UP now reads as the reward
// (exciting), slowing DOWN as the penalty. Effects are no longer timed;
// they persist (compounding on repeat contact) until the next event or a
// room-local restart. Deliberately NOT mathematical inverses of each other
// (1 / 1.35 ~= 0.74, not 0.7) -- independently PO-tunable, per the task's
// own explicit instruction not to assume symmetry.
/** Reward: multiplies CURRENT ball speed UP on contact, clamped by the
 *  engine's existing maxSpeed ceiling. */
export const DRIFTING_ORB_REWARD_SPEED_STEP = 1.35;
/** Penalty: multiplies CURRENT ball speed DOWN on contact, clamped by the
 *  NEW minSpeed floor (micro-breaks/tuning.ts's MIN_SPEED_PX_PER_SECOND). */
export const DRIFTING_ORB_PENALTY_SPEED_STEP = 0.7;

// MB-13, ADR-0015 §12: Room 3's one content lever -- a faster drifting-orb
// spawn cadence than Room 2's, reusing the exact same reward/penalty roles/
// effects/paddle/miss behavior (buildDriftingOrbSpawnConfig only swaps this
// one field in for Room 3; everything else is Room 2's recipe, unchanged).
// Smaller interval, not a new mechanic.
export const ROOM_3_DRIFTING_ORB_SPAWN_INTERVAL_MS = 2500;

// ── Idle rim appearance (ADR-0015 §11: visible pre-contact, NEVER
//    reduced-motion-gated -- a static shape, not animation) ─────────────
export const DRIFTING_ORB_RIM_LINE_WIDTH = 2;
/** Notched/dashed rim -- Haste (penalty). Calm's rim is smooth/continuous,
 *  expressed as an empty dash array at the call site (no separate constant
 *  needed for "no dash"). */
export const DRIFTING_ORB_PENALTY_RIM_DASH: readonly number[] = [4, 3];

// ── Absorb (Calm/reward) reaction -- converging particles + a single
//    smooth brightening pulse. Reduced-motion suppresses the particles
//    (motion) but NEVER the pulse (a color/brightness cue, ADR-0015 §11) ─
export const DRIFTING_ORB_ABSORB_PARTICLE_COUNT = 10;
export const DRIFTING_ORB_ABSORB_PARTICLE_ARRIVAL_MS = 260;
export const DRIFTING_ORB_ABSORB_PULSE_DURATION_MS = 260;
export const DRIFTING_ORB_ABSORB_PULSE_PEAK_ALPHA = 0.5;
export function getDriftingOrbAbsorbParticleCount(reducedMotion: boolean): number {
  return reducedMotion ? 0 : DRIFTING_ORB_ABSORB_PARTICLE_COUNT;
}

// ── Jolt (Haste/penalty) reaction -- outward particle burst + sharp
//    double-flash + a small bounded shake. Reduced-motion suppresses the
//    particles AND the shake (both motion) but NEVER the flash (a
//    color/brightness cue, ADR-0015 §11) ─────────────────────────────────
export const DRIFTING_ORB_JOLT_PARTICLE_COUNT = 14;
export const DRIFTING_ORB_JOLT_FLASH_DURATION_MS = 260;
export const DRIFTING_ORB_JOLT_FLASH_PEAK_ALPHA = 0.6;
export const DRIFTING_ORB_JOLT_SHAKE_DURATION_MS = 220;
export const DRIFTING_ORB_JOLT_SHAKE_MAGNITUDE_PX = 4;
export function getDriftingOrbJoltParticleCount(reducedMotion: boolean): number {
  return reducedMotion ? 0 : DRIFTING_ORB_JOLT_PARTICLE_COUNT;
}

// ── NEW, MB-10, ADR-0015 §11 (revision): penalty-role paddle-catch --
// a successful defensive block. Deliberately a THIRD, minimal, distinct
// cue -- neither Absorb's inward-converge nor Jolt's outward-burst+shake --
// a small puff AT THE PADDLE (not the ball) reusing the existing outward-
// particle primitive at low cost, plus a brief static pulse ring so the
// cue survives reduced motion too (same split as Absorb/Jolt: the burst,
// motion, is suppressed; a static brightness cue is not, consistent with
// this feature's established reduced-motion convention -- a successful
// block is gameplay feedback, not decoration). Deliberately fewer
// particles than Jolt's burst -- "low cost," per the task brief. ─────────
export const DRIFTING_ORB_PADDLE_CATCH_PARTICLE_COUNT = 6;
export const DRIFTING_ORB_PADDLE_CATCH_PULSE_DURATION_MS = 220;
export const DRIFTING_ORB_PADDLE_CATCH_PULSE_PEAK_ALPHA = 0.4;
export function getDriftingOrbPaddleCatchParticleCount(reducedMotion: boolean): number {
  return reducedMotion ? 0 : DRIFTING_ORB_PADDLE_CATCH_PARTICLE_COUNT;
}
