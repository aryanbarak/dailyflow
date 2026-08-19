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
/** Multiplies baseSpeed per room index beyond 1 (room 2 = 1x this beyond
 *  Room 1's base, etc.) -- small per-room step, not a steep ramp, since the
 *  per-hit speedRampPerHit already escalates difficulty WITHIN a room. */
export const ROOM_DIFFICULTY_SPEED_STEP = 0.08;
/** Shrinks paddle width per room index beyond 1, floored at
 *  ROOM_MIN_PADDLE_WIDTH_RATIO so late rooms stay legitimately playable. */
export const ROOM_DIFFICULTY_PADDLE_SHRINK_STEP = 0.04;
export const ROOM_MIN_PADDLE_WIDTH_RATIO = 0.55; // of the base paddle width

// ── Room transition (ADR-0015 §2: short, reduced-motion-aware, no reload) ─
export const ROOM_TRANSITION_SECONDS = 0.5;
export const ROOM_TRANSITION_SECONDS_REDUCED_MOTION = 0; // instant, per Build 4's brief
