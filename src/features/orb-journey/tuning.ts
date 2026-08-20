// MB-05, ADR-0015 §4/§7: Orb Journey feel-tuning constants, gathered in one
// file (mirrors the convention established by micro-breaks/tuning.ts).
// PO-approved-shape defaults, not independently validated against real
// playtesting -- flagged in the MB-05 report as a judgment call, same as
// MB-03's tuning.ts was.

// ── Progressive play-area growth (ADR-0015 §13, MB-14, Journey-only) ────
// MB-15 (coordinator-error correction): Room 1's baseline was originally
// defined as "today's (MB-05-era) width" and implemented by reusing
// micro-breaks/tuning.ts's BOARD_MAX_WIDTH_PX (480) -- silently assuming
// that width already satisfied the ACTUAL product requirement (PO,
// pre-MB-14): Room 1 genuinely narrow, dashboard clearly visible on both
// sides. It didn't -- 480px was sized for comfortable gameplay, not for
// "narrow." PO confirmed on a real browser that Room 1 still showed little
// to no visible dashboard. JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX below is the
// fix: a NEW, distinctly smaller, Journey-specific constant, no longer
// derived from BOARD_MAX_WIDTH_PX at all. MB-14's growth CURVE SHAPE
// (linear, room-index-formula-driven, not per-room authored) and its
// room-10 full-screen target are UNCHANGED -- only this one starting
// endpoint moves; see JOURNEY_PLAY_AREA_GROWTH_STEP's own comment for how
// the step is re-derived to still land exactly on both endpoints.
//
// The growth formula returns a RATIO (0..1), per the task brief's own
// contract -- but a ratio applied DIRECTLY as a fraction of the LIVE
// viewport width (e.g. `ratio * 100vw`) cannot simultaneously reproduce a
// genuinely narrow desktop baseline AND "a usable, not over-shrunk width on
// mobile" (a narrow-enough-for-desktop ratio, applied to a phone's own
// narrow viewport, would make Room 1 render at a tiny fraction of the
// phone's OWN screen). This is the mobile/desktop conflict the MB-14 task
// brief asked to be flagged rather than silently resolved (see that
// report), and MB-15 revisits it below now that the baseline is smaller
// than most real phone widths (480 was comfortably ABOVE typical phones;
// 300 is comfortably BELOW them) -- see JOURNEY_PLAY_AREA_MIN_WIDTH_PX's
// own comment for the follow-on mobile analysis this change requires.
//
// Resolution (unchanged mechanism from MB-14): the ratio is calibrated
// against a fixed REFERENCE viewport width (generously large -- above the
// vast majority of real desktop/laptop screens), not the live one. The
// resulting PIXEL cap (ratio * REFERENCE_WIDTH_PX) is then combined with
// the SAME `min(100%, ...)` hybrid this codebase already uses
// (`w-full max-w-[Npx]`), so at room 10 (ratio 1.0) the pixel cap equals
// the reference width itself -- comfortably wider than the vast majority of
// real screens, so 100% wins there: TRUE full-viewport coverage for
// virtually all users. Flagged limitation (unchanged from MB-14): a monitor
// wider than JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX would be capped just
// short of literal 100vw at room 10 -- an edge case affecting only
// ultra-wide displays.
export const JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX = 2560;
// MB-15: the new, genuinely narrow Room-1 baseline. Reasoned from a common
// ~1440-1920px desktop viewport: at 300px, a centered play area leaves
// (1440-300)/2 = 570px of visible dashboard on EACH side at the narrower
// end of that range, and (1920-300)/2 = 810px at the wider end -- roughly
// 40% of viewport width per side even on a modest 1280px laptop screen
// ((1280-300)/2 = 490px, ~38%) -- clearly, unambiguously "dashboard visible
// on both sides," not a marginal case. Chosen within the task brief's own
// ~280-320px suggested range; picked at the round, legible end of it. Still
// comfortably above BOARD_MIN_WIDTH_PX (240, micro-breaks/tuning.ts's own
// absolute engine-level floor for board legibility), so this isn't pushing
// against any existing hard limit.
export const JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX = 300;
/** Room 1's ratio, BY CONSTRUCTION, reproduces
 *  JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX exactly when multiplied back out by
 *  JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX -- see this section's own header
 *  comment. */
export const JOURNEY_PLAY_AREA_BASELINE_RATIO = JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX / JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX;
/** Per PO direction: growth is gradual, full-screen reached AROUND room 10,
 *  not sooner (ADR-0015 §13). UNCHANGED by MB-15 -- the ending endpoint,
 *  only the starting endpoint moved. */
export const JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX = 10;
/** Linear step size, derived (not a magic number) so the two endpoints the
 *  task brief actually specifies land exactly: ratio(1) ==
 *  JOURNEY_PLAY_AREA_BASELINE_RATIO, and ratio(JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX)
 *  == 1.0. Solving baseline + (targetRoom - 1) * step = 1 for step:
 *  step = (1 - baseline) / (targetRoom - 1). MB-15: this formula itself is
 *  UNCHANGED from MB-14 -- only JOURNEY_PLAY_AREA_BASELINE_RATIO's value
 *  feeding it moved, so the step recalculates automatically to still land
 *  exactly on the SAME room-10 target with the NEW, smaller starting point. */
export const JOURNEY_PLAY_AREA_GROWTH_STEP =
  (1 - JOURNEY_PLAY_AREA_BASELINE_RATIO) / (JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX - 1);

// MB-15: a NEW, independent absolute pixel floor -- "mobile/touch safety,"
// per the task brief -- distinct from BOARD_MIN_WIDTH_PX (the shared
// physics engine's own hard floor, 240px, used by Quick Break too).
// Deliberately set BELOW JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX (300): a floor
// ABOVE the baseline would override Room 1's own genuinely-narrow starting
// width, defeating this entire correction's purpose, so the only coherent
// choice is a floor at or below it. 20px above BOARD_MIN_WIDTH_PX,
// reflecting that Journey specifically wants a slightly higher comfort bar
// than Quick Break's bare-minimum tolerance.
//
// Honest finding on redundancy (task brief explicitly asked this to be
// verified, not assumed): getJourneyPlayAreaMaxWidthPx is monotonically
// NON-DECREASING starting exactly AT the baseline (see
// getJourneyPlayAreaWidthRatio's own clamp), so for EVERY room index,
// getJourneyPlayAreaMaxWidthPx(roomIndex) >= JOURNEY_PLAY_AREA_BASELINE_WIDTH_PX
// (300) > JOURNEY_PLAY_AREA_MIN_WIDTH_PX (260) -- the floor applied below
// can NEVER currently bind, for ANY room, given these constants. This is
// NOT a live gap MB-14's existing `min(100%, cap)` mobile composition
// leaves open today -- confirmed, not assumed, and said explicitly rather
// than silently wiring in a path that never executes for its own sake. It
// is still applied (as Math.max, a standard defensive clamp, the same
// pattern computeBoardConfig's own BOARD_MIN_WIDTH_PX clamp already uses)
// as a genuine safety net: it protects against a FUTURE tuning edit to the
// baseline/reference/target constants above accidentally pushing Room 1
// below a comfortable touch-target width without anyone noticing, which a
// bare Math.max with no floor at all would not catch.
export const JOURNEY_PLAY_AREA_MIN_WIDTH_PX = 260;

/** Pure: room index -> play-area width as a ratio (0..1) of the REFERENCE
 *  viewport width (see this section's header comment -- NOT the live
 *  viewport, which is what makes the mobile/desktop composition work).
 *  Monotonically increasing, linear, clamped at 1.0 from room
 *  JOURNEY_PLAY_AREA_FULL_SCREEN_ROOM_INDEX onward. Independent of gameplay
 *  difficulty (§4) -- reads nothing from, and is read by nothing in,
 *  deriveRoomEngineConfig's speed/paddle-width formula. */
export function getJourneyPlayAreaWidthRatio(roomIndex: number): number {
  const raw = JOURNEY_PLAY_AREA_BASELINE_RATIO + (roomIndex - 1) * JOURNEY_PLAY_AREA_GROWTH_STEP;
  return Math.min(1, Math.max(JOURNEY_PLAY_AREA_BASELINE_RATIO, raw));
}

/** Pure: room index -> play-area max-width in PIXELS, against the
 *  REFERENCE viewport. The SINGLE value fed to BOTH the play-area
 *  container's CSS max-width (MicroBreakOverlay.tsx) and
 *  computeBoardConfig's new maxWidthPx override (JourneyCanvas.tsx) -- one
 *  computed value, not two separately-tuned numbers that could drift apart
 *  (see this section's header comment and the MB-14 report's consistency
 *  test). MB-15: now also floored at JOURNEY_PLAY_AREA_MIN_WIDTH_PX -- see
 *  that constant's own comment for why this is currently a non-binding
 *  safety net, not a live behavior change. */
export function getJourneyPlayAreaMaxWidthPx(roomIndex: number): number {
  return Math.max(getJourneyPlayAreaWidthRatio(roomIndex) * JOURNEY_PLAY_AREA_REFERENCE_WIDTH_PX, JOURNEY_PLAY_AREA_MIN_WIDTH_PX);
}

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
