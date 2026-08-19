// ADR-0014 §4, MB-02 slice 1 / MB-03 slice 2: pure Classic Pong physics. No
// DOM, no React, no timers -- callers (PongCanvas's rAF loop) own real time
// and pass a per-frame delta in. Kept pure so the collision/angle/speed-cap/
// dt-clamp/combo/final-wave/resize rules are unit-testable without a canvas
// or a browser event loop.

import { DEFAULT_MICRO_BREAK_DURATION_SECONDS, type MicroBreakDurationSeconds } from '../types';
import {
  BALL_RADIUS_RATIO,
  BASE_SCORE_PER_HIT,
  BASE_SPEED_PX_PER_SECOND,
  BOARD_ASPECT_RATIO,
  BOARD_MAX_WIDTH_PX,
  BOARD_MIN_WIDTH_PX,
  COMBO_MULTIPLIER_CAP,
  FINAL_WAVE_RAMP_BOOST,
  FINAL_WAVE_WINDOW_SECONDS,
  MAX_BOUNCE_ANGLE_DEGREES,
  MAX_SPEED_PX_PER_SECOND,
  PADDLE_BOTTOM_MARGIN_RATIO,
  PADDLE_HEIGHT_RATIO,
  PADDLE_WIDTH_RATIO,
  SPEED_RAMP_PER_HIT,
} from '../tuning';

export interface PongVec2 {
  readonly x: number;
  readonly y: number;
}

// MB-07, ADR-0015 §10 (amendment): a rectangular collision surface beyond
// the walls/paddle. `breakable`/`comboThresholdToBreak` are read ONLY by the
// obstacle-collision branch below -- a non-breakable obstacle (unused this
// slice, supported for forward compatibility per §10's own "may be marked
// breakable") just bounces the ball forever, like a wall.
export interface PongObstacleConfig {
  readonly id: string;
  readonly x: number; // top-left
  readonly y: number; // top-left
  readonly width: number;
  readonly height: number;
  readonly breakable: boolean;
  /** Combo required, AT THE MOMENT OF CONTACT, to break this obstacle.
   *  Meaningless when `breakable` is false. A per-obstacle field (not read
   *  from any orb-journey module here) -- the room layer resolves this from
   *  its own tuning constant when building the room's obstacle list, so
   *  this engine file stays free of any orb-journey-specific import. */
  readonly comboThresholdToBreak?: number;
}

// Per-instance broken/intact flag, one entry per `PongEngineConfig.obstacles`
// in the same order. Deliberately NOT part of `PongObstacleConfig` -- config
// is the room's fixed authoring data, state is what changes as the room is
// played.
export interface PongObstacleState {
  readonly id: string;
  readonly broken: boolean;
}

export interface PongEngineConfig {
  readonly width: number;
  readonly height: number;
  readonly paddleWidth: number;
  readonly paddleHeight: number;
  readonly paddleY: number; // top edge of the paddle rect
  readonly ballRadius: number;
  readonly baseSpeed: number; // px/s at game start
  readonly maxSpeed: number; // px/s hard cap (progressive speed ceiling, unaffected by the final-wave ramp boost)
  readonly speedRampPerHit: number; // multiplier applied to speed on each paddle hit
  readonly maxBounceAngleRad: number; // degenerate-angle prevention bound -- must stay < Math.PI / 2
  readonly durationSeconds: MicroBreakDurationSeconds;
  readonly baseScorePerHit: number; // MB-03: score awarded per hit before the combo multiplier
  readonly comboCap: number; // MB-03: combo multiplier hard cap (named constant, ADR-0014 §11-12)
  readonly finalWaveWindowSeconds: number; // MB-03: last N seconds of the session
  readonly finalWaveRampBoost: number; // MB-03: multiplies speedRampPerHit's per-hit INCREMENT during the final wave, never the hard cap
  /** MB-07, ADR-0015 §10 (amendment): optional additional collision
   *  surfaces beyond the walls/paddle. Undefined/empty for Quick Break
   *  (ADR-0014) and Orb Journey's Room 1 -- both provably unaffected by
   *  this field's mere existence, since every read of it below is gated on
   *  `config.obstacles && config.obstacles.length > 0`. */
  readonly obstacles?: readonly PongObstacleConfig[];
}

export const DEFAULT_PONG_CONFIG: PongEngineConfig = {
  width: 400,
  height: 600,
  paddleWidth: 90,
  paddleHeight: 14,
  paddleY: 560,
  ballRadius: 8,
  baseSpeed: BASE_SPEED_PX_PER_SECOND,
  maxSpeed: MAX_SPEED_PX_PER_SECOND,
  speedRampPerHit: SPEED_RAMP_PER_HIT,
  maxBounceAngleRad: (MAX_BOUNCE_ANGLE_DEGREES * Math.PI) / 180,
  durationSeconds: DEFAULT_MICRO_BREAK_DURATION_SECONDS,
  baseScorePerHit: BASE_SCORE_PER_HIT,
  comboCap: COMBO_MULTIPLIER_CAP,
  finalWaveWindowSeconds: FINAL_WAVE_WINDOW_SECONDS,
  finalWaveRampBoost: FINAL_WAVE_RAMP_BOOST,
};

export type PongStatus = 'playing' | 'ended';

export interface PongState {
  readonly ball: PongVec2;
  readonly ballVelocity: PongVec2; // px/s
  readonly paddleX: number; // paddle center x
  readonly score: number;
  readonly combo: number; // MB-03: consecutive-hit streak; resets to 0 on a floor bounce (miss), never reduces score
  readonly elapsedSeconds: number;
  readonly status: PongStatus;
  /** MB-05, ADR-0015: monotonically incremented every time the floor-bounce
   *  branch below runs. Purely additive -- Quick Break (ADR-0014) never
   *  reads it, floor-bounce PHYSICS are completely unchanged. Exists so a
   *  caller layered ON TOP of this engine (Orb Journey's roomEngine.ts) can
   *  detect "a miss just happened" unambiguously, including the case where
   *  `combo` was already 0 (e.g. the very first shot of a room) and
   *  therefore gives no signal on its own. ADR-0015 §1/§4 build order is
   *  explicit that Journey must configure this shared engine, not fork it --
   *  this field is the seam that makes that possible without touching the
   *  bounce behavior itself. */
  readonly floorMissCount: number;
  /** MB-07, ADR-0015 §10 (amendment): per-instance broken/intact flags, one
   *  entry per `config.obstacles`, same order. Re-derived fresh (all
   *  intact) every time `createInitialPongState` runs -- which is exactly
   *  what a room-local restart already calls (roomEngine.ts's stepJourney
   *  miss-restart branch), so a broken obstacle automatically reappears
   *  after a floor miss with NO separate reset code needed. Empty for
   *  Quick Break and any room with no obstacles. */
  readonly obstacles: readonly PongObstacleState[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function magnitude(x: number, y: number): number {
  return Math.hypot(x, y);
}

// Deterministic launch (no RNG) -- 30 degrees off vertical towards the
// right, so the engine's output is exactly reproducible in tests.
export function createInitialPongState(config: PongEngineConfig = DEFAULT_PONG_CONFIG): PongState {
  const launchAngle = Math.PI / 6; // 30 degrees from vertical
  return {
    ball: { x: config.width / 2, y: config.height / 2 },
    ballVelocity: {
      x: config.baseSpeed * Math.sin(launchAngle),
      y: -config.baseSpeed * Math.cos(launchAngle),
    },
    paddleX: config.width / 2,
    score: 0,
    combo: 0,
    elapsedSeconds: 0,
    status: 'playing',
    floorMissCount: 0,
    obstacles: (config.obstacles ?? []).map(obstacle => ({ id: obstacle.id, broken: false })),
  };
}

export function setPaddleX(state: PongState, x: number, config: PongEngineConfig): PongState {
  const half = config.paddleWidth / 2;
  const clamped = clamp(x, half, config.width - half);
  if (clamped === state.paddleX) return state;
  return { ...state, paddleX: clamped };
}

export function getRemainingSeconds(state: PongState, config: PongEngineConfig): number {
  return Math.max(0, config.durationSeconds - state.elapsedSeconds);
}

// MB-03, ADR-0014 §12: last `finalWaveWindowSeconds` of a still-playing
// session. Pure, so both the engine (speed ramp boost) and the renderer/HUD
// (visual boost, i18n indicator) derive the SAME answer from the SAME rule
// -- no separate "is it the final wave" heuristic duplicated per consumer.
export function isFinalWave(state: PongState, config: PongEngineConfig): boolean {
  return state.status === 'playing' && getRemainingSeconds(state, config) <= config.finalWaveWindowSeconds;
}

// ADR-0014 §4: dt is clamped AND substepped.
// - MAX_SUBSTEP_MS keeps a single larger caller-supplied delta (e.g. one
//   32ms frame at ~30fps, or a batched delta) integrating in the SAME small
//   increments a 60Hz caller would use one frame at a time -- this is what
//   makes 60Hz and 120Hz callers converge on the same trajectory (ADR-0014
//   §4 acceptance criterion), and is directly exercised by this module's
//   own test ("one 32ms step == two 16ms steps").
// - MAX_TOTAL_STEP_MS is the absolute ceiling per call: a tab suspended for
//   15s and then resumed must never integrate 15 real seconds of physics in
//   one jump (the ball would teleport across/through the paddle). The
//   caller (useVisibilityAwareGameLoop) is expected to also reset its own
//   previous-timestamp reference on resume so it never even PASSES a huge
//   delta in the first place -- this clamp is the second, independent line
//   of defense directly inside the engine.
const MAX_SUBSTEP_MS = 16;
const MAX_TOTAL_STEP_MS = 250;

function integrateSubstep(state: PongState, dtMs: number, config: PongEngineConfig): PongState {
  const dt = dtMs / 1000;
  let x = state.ball.x + state.ballVelocity.x * dt;
  let y = state.ball.y + state.ballVelocity.y * dt;
  let vx = state.ballVelocity.x;
  let vy = state.ballVelocity.y;
  let score = state.score;
  let combo = state.combo;
  let floorMissCount = state.floorMissCount;
  let obstacles = state.obstacles;

  const r = config.ballRadius;

  if (x - r < 0) {
    x = r;
    vx = Math.abs(vx);
  } else if (x + r > config.width) {
    x = config.width - r;
    vx = -Math.abs(vx);
  }

  if (y - r < 0) {
    y = r;
    vy = Math.abs(vy);
  }

  // MB-07, ADR-0015 §10 (amendment): obstacle collision, resolved BEFORE the
  // paddle check below so a threshold check ("combo at the moment of
  // contact") reads this substep's ENTERING combo, not a value already
  // bumped by a paddle hit later in the same substep. Gated on
  // config.obstacles existing/non-empty, so Quick Break and Room 1 (both
  // pass no obstacles) never even enter this branch -- their physics are
  // byte-for-byte unchanged.
  if (config.obstacles && config.obstacles.length > 0) {
    for (let i = 0; i < config.obstacles.length; i++) {
      const obstacleConfig = config.obstacles[i];
      const obstacleState = obstacles[i];
      if (!obstacleState || obstacleState.broken) continue;

      const ballLeft = x - r;
      const ballRight = x + r;
      const ballTop = y - r;
      const ballBottom = y + r;
      const obstacleRight = obstacleConfig.x + obstacleConfig.width;
      const obstacleBottom = obstacleConfig.y + obstacleConfig.height;

      const overlapping = ballRight > obstacleConfig.x && ballLeft < obstacleRight && ballBottom > obstacleConfig.y && ballTop < obstacleBottom;
      if (!overlapping) continue;

      // Minimum-translation-vector resolution: reflect off whichever face
      // has the LEAST overlap -- the same "closest face wins" principle the
      // wall checks above use (each wall only tests its own single axis),
      // generalized to 4 directions since an obstacle (unlike the paddle,
      // always approached from above) can be approached from any side.
      const overlapLeft = ballRight - obstacleConfig.x;
      const overlapRight = obstacleRight - ballLeft;
      const overlapTop = ballBottom - obstacleConfig.y;
      const overlapBottom = obstacleBottom - ballTop;
      const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

      if (minOverlap === overlapTop) {
        y = obstacleConfig.y - r;
        vy = -Math.abs(vy);
      } else if (minOverlap === overlapBottom) {
        y = obstacleBottom + r;
        vy = Math.abs(vy);
      } else if (minOverlap === overlapLeft) {
        x = obstacleConfig.x - r;
        vx = -Math.abs(vx);
      } else {
        x = obstacleRight + r;
        vx = Math.abs(vx);
      }

      // ADR-0015 §10: breaking requires combo >= the configured threshold at
      // the moment of contact -- a skill reward, not a default interaction.
      // Breaking never changes the reflection computed above ("ball
      // reflects normally either way").
      if (obstacleConfig.breakable && combo >= (obstacleConfig.comboThresholdToBreak ?? 0)) {
        obstacles = obstacles.map((entry, index) => (index === i ? { ...entry, broken: true } : entry));
      }
    }
  }

  const paddleTop = config.paddleY;
  const paddleBottom = config.paddleY + config.paddleHeight;
  const paddleLeft = state.paddleX - config.paddleWidth / 2;
  const paddleRight = state.paddleX + config.paddleWidth / 2;

  // Only checked while travelling downward into the paddle's band, so a
  // ball already reflected upward this same substep can't double-hit.
  let hitPaddle = false;
  if (vy > 0 && y + r >= paddleTop && y - r <= paddleBottom && x >= paddleLeft && x <= paddleRight) {
    hitPaddle = true;
    y = paddleTop - r;

    // Contact-point -> angle mapping: -1 (left edge) .. 0 (center) .. 1
    // (right edge), scaled to +/- maxBounceAngleRad. maxBounceAngleRad is
    // configured strictly below 90 degrees, which is what structurally
    // prevents the degenerate case (a bounce angle at/near 90 degrees would
    // send the ball travelling almost horizontally forever) -- the
    // vertical speed component is always at least
    // speed * cos(maxBounceAngleRad) in magnitude.
    const relative = clamp((x - state.paddleX) / (config.paddleWidth / 2), -1, 1);
    const angle = relative * config.maxBounceAngleRad;

    // MB-03, ADR-0014 §12: the final wave boosts the PER-HIT ramp rate
    // (speed converges to maxSpeed faster) -- the hard cap itself is
    // completely unaffected, so this can never exceed Slice 1's own
    // ceiling. `isFinalWave` reads `state` (this substep's ENTERING
    // elapsed time), not the not-yet-computed post-substep value.
    const rampPerHit = isFinalWave(state, config)
      ? 1 + (config.speedRampPerHit - 1) * config.finalWaveRampBoost
      : config.speedRampPerHit;
    const speed = Math.min(magnitude(vx, vy) * rampPerHit, config.maxSpeed);
    vx = speed * Math.sin(angle);
    vy = -speed * Math.cos(angle);

    // MB-03, ADR-0014 §11-12: combo increments BEFORE the score gain is
    // computed, so the FIRST hit in a streak (combo becomes 1) is worth
    // baseScorePerHit * 1, matching Slice 1's flat "+1 per hit" exactly for
    // an isolated (non-combo) hit -- this is a strict extension, not a
    // rebalance of single-hit scoring.
    combo += 1;
    score += config.baseScorePerHit * Math.min(combo, config.comboCap);
  }

  // ADR-0014 §7: "no lives" -- a missed paddle still just bounces off the
  // floor; the fixed-duration timer is the only end condition. MB-03: a
  // miss resets the combo streak but NEVER reduces score (score is
  // monotonically non-decreasing across the whole session).
  if (!hitPaddle && y + r > config.height) {
    y = config.height - r;
    vy = -Math.abs(vy);
    combo = 0;
    floorMissCount += 1;
  }

  const elapsedSeconds = state.elapsedSeconds + dt;
  const status: PongStatus = elapsedSeconds >= config.durationSeconds ? 'ended' : 'playing';

  return {
    ball: { x, y },
    ballVelocity: { x: vx, y: vy },
    paddleX: state.paddleX,
    score,
    combo,
    elapsedSeconds,
    status,
    floorMissCount,
    obstacles,
  };
}

export function stepPong(state: PongState, rawDtMs: number, config: PongEngineConfig = DEFAULT_PONG_CONFIG): PongState {
  if (state.status === 'ended' || rawDtMs <= 0) return state;

  const clampedTotalMs = Math.min(rawDtMs, MAX_TOTAL_STEP_MS);
  let current = state;
  let remainingMs = clampedTotalMs;

  while (remainingMs > 0 && current.status === 'playing') {
    const subMs = Math.min(remainingMs, MAX_SUBSTEP_MS);
    current = integrateSubstep(current, subMs, config);
    remainingMs -= subMs;
  }

  return current;
}

// MB-03, mobile/PWA acceptance (ADR-0014 §4 spirit -- "no teleport"):
// orientation change / viewport resize mid-game must re-derive field
// dimensions WITHOUT the ball or paddle jumping to a nonsensical position.
// Scales every position/velocity component proportionally to the
// width/height ratio between the old and new board config, then clamps to
// the new bounds -- so relative position (e.g. "ball at 50% width") is
// preserved and nothing can end up outside the new playable area. Pure and
// stateless: the caller (PongCanvas's resize handler) is responsible for
// calling this exactly once per actual dimension change, atomically with
// updating the config it hands to subsequent stepPong calls.
export function rescalePongState(state: PongState, oldConfig: PongEngineConfig, newConfig: PongEngineConfig): PongState {
  if (oldConfig.width === newConfig.width && oldConfig.height === newConfig.height) return state;

  const scaleX = newConfig.width / oldConfig.width;
  const scaleY = newConfig.height / oldConfig.height;
  const r = newConfig.ballRadius;
  const halfPaddle = newConfig.paddleWidth / 2;

  return {
    ...state,
    ball: {
      x: clamp(state.ball.x * scaleX, r, newConfig.width - r),
      y: clamp(state.ball.y * scaleY, r, newConfig.height - r),
    },
    ballVelocity: {
      x: state.ballVelocity.x * scaleX,
      y: state.ballVelocity.y * scaleY,
    },
    paddleX: clamp(state.paddleX * scaleX, halfPaddle, newConfig.width - halfPaddle),
  };
}

// MB-03, mobile/PWA acceptance: derives a board's DIMENSIONAL fields
// (width/height/paddleWidth/paddleHeight/ballRadius/paddleY) from an
// available container size, preserving the board's aspect ratio and the
// tuned proportions (paddle/ball size relative to board width, paddle's
// bottom margin -- see tuning.ts). Every OTHER field of `base` (speeds,
// combo, final-wave, durationSeconds) passes through unchanged -- this
// function only ever touches layout, never gameplay tuning. Pure: the
// caller (PongCanvas's ResizeObserver handler) measures the real container
// and is responsible for calling rescalePongState alongside this so the
// running ball/paddle position tracks the new board without teleporting.
export function computeBoardConfig(
  containerWidthPx: number,
  containerHeightPx: number,
  base: PongEngineConfig = DEFAULT_PONG_CONFIG,
): PongEngineConfig {
  // Fits inside whichever container axis is more constraining, then clamps
  // to the tuned [MIN, MAX] range. BOARD_MIN_WIDTH_PX assumes a realistic
  // phone-viewport-sized container (this overlay is full-screen); a
  // container narrower than that is an out-of-scope degenerate case, not a
  // real device, so the floor is allowed to win there rather than shipping
  // an unplayably tiny board.
  const widthFromHeight = containerHeightPx * BOARD_ASPECT_RATIO;
  const fitWidth = Math.min(containerWidthPx, widthFromHeight);
  const width = clamp(fitWidth, BOARD_MIN_WIDTH_PX, BOARD_MAX_WIDTH_PX);
  const height = width / BOARD_ASPECT_RATIO;
  const paddleHeight = height * PADDLE_HEIGHT_RATIO;

  return {
    ...base,
    width,
    height,
    paddleWidth: width * PADDLE_WIDTH_RATIO,
    paddleHeight,
    ballRadius: width * BALL_RADIUS_RATIO,
    paddleY: height * (1 - PADDLE_BOTTOM_MARGIN_RATIO) - paddleHeight,
  };
}
