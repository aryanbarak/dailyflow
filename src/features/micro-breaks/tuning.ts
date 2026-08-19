// MB-03, Micro Breaks Slice 2, item 5 (ADR-0014 §11): every feel-tuning
// constant gathered in one file, so future tuning passes touch one place
// instead of hunting through the engine/renderer/overlay. Values here are
// PO-approved-shape defaults, not independently validated against real
// playtesting -- flagged in the MB-03 report as a judgment call.

// ── Combo (ADR-0014 §11-12) ─────────────────────────────────────────────
/** Score awarded for a single, non-combo paddle hit. */
export const BASE_SCORE_PER_HIT = 1;
/** Combo multiplier hard cap -- hit N in a streak is worth
 *  BASE_SCORE_PER_HIT * min(comboAfterThisHit, COMBO_MULTIPLIER_CAP). */
export const COMBO_MULTIPLIER_CAP = 5;

// ── Sensory final wave (ADR-0014 §12 -- NO score multiplier) ───────────
/** Last N seconds of a session: brighter trail, stronger glow, faster ramp. */
export const FINAL_WAVE_WINDOW_SECONDS = 10;
/** Multiplies the PER-HIT speed ramp (not the hard cap) while in the final wave. */
export const FINAL_WAVE_RAMP_BOOST = 1.6;
/** Decorative-only boosts applied by the renderer during the final wave (skipped entirely under reduced motion). */
export const FINAL_WAVE_TRAIL_ALPHA_BOOST = 1.6;
export const FINAL_WAVE_GLOW_BLUR_BOOST = 1.5;

// ── Physics defaults (unchanged from Slice 1, gathered here now) ───────
export const BASE_SPEED_PX_PER_SECOND = 220;
export const MAX_SPEED_PX_PER_SECOND = 640;
/** MB-10, ADR-0015 §11 (revision): symmetric floor to MAX_SPEED_PX_PER_SECOND
 *  -- required so a drifting-orb penalty (or a run of them) can never drive
 *  the ball to a near-zero, degenerate speed. Inert for Quick Break (no
 *  drifting orbs ever apply it), well below BASE_SPEED_PX_PER_SECOND so it
 *  never interferes with normal Orb Journey ramping either. */
export const MIN_SPEED_PX_PER_SECOND = 90;
export const SPEED_RAMP_PER_HIT = 1.045;
export const MAX_BOUNCE_ANGLE_DEGREES = 60;

// ── Board (Slice 2: responsive, see engine/resize.ts) ──────────────────
export const BOARD_ASPECT_RATIO = 400 / 600; // width / height, preserved when the board is resized to fit a container
export const BOARD_MIN_WIDTH_PX = 240;
export const BOARD_MAX_WIDTH_PX = 480;
export const PADDLE_WIDTH_RATIO = 90 / 400; // of board width
export const PADDLE_HEIGHT_RATIO = 14 / 600; // of board height
export const BALL_RADIUS_RATIO = 8 / 400; // of board width
/** Paddle's distance from the board's bottom edge, as a fraction of board
 *  height -- deliberately generous (Slice 1 shipped ~4%) so a thumb resting
 *  near the bottom edge of the screen lands BELOW the paddle, never
 *  covering it (mobile/PWA acceptance, ADR-0014 §11 "paddle control
 *  comfort"). Paddle Y never follows the finger -- only X does -- so this
 *  margin is the only lever that actually controls "does my hand block my
 *  own paddle." */
export const PADDLE_BOTTOM_MARGIN_RATIO = 0.12;

// ── Rendering (trail/squash, unchanged shape from Slice 1) ─────────────
export const TRAIL_LENGTH = 10;
export const TRAIL_LENGTH_REDUCED_MOTION = 3;
export const SQUASH_DURATION_MS = 120;

// ── Particles (Slice 2, item 5 -- very limited, gone under reduced motion) ─
export const PARTICLE_COUNT_PER_HIT = 6;
export const PARTICLE_LIFETIME_MS = 350;
export const PARTICLE_SPEED_PX_PER_SECOND = 90;

/** ADR-0014 §11 reduced-motion rule, extended to particles: zero particles,
 *  never a smaller number -- a "few" particles is still an extra effect. */
export function getParticleCountForMotionPreference(reducedMotion: boolean): number {
  return reducedMotion ? 0 : PARTICLE_COUNT_PER_HIT;
}

// ── Handoff transition (unchanged from Slice 1) ─────────────────────────
export const HANDOFF_TRANSITION_SECONDS = 0.28;
export const HANDOFF_EASE = [0.22, 1, 0.36, 1] as const;

// ── Converging particles (MB-08, ADR-0015 §11 amendment -- Orb Journey's
//    drifting-orb "Absorb" reaction; the geometric inverse of the outward
//    burst above) ────────────────────────────────────────────────────────
/** Ring radius (px) particles start at before converging toward the target. */
export const CONVERGING_PARTICLE_RING_RADIUS_PX = 26;
