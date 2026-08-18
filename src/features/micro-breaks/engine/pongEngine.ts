// ADR-0014 §4, MB-02 slice 1: pure Classic Pong physics. No DOM, no React,
// no timers -- callers (PongCanvas's rAF loop) own real time and pass a
// per-frame delta in. Kept pure so the collision/angle/speed-cap/dt-clamp
// rules are unit-testable without a canvas or a browser event loop.

import { DEFAULT_MICRO_BREAK_DURATION_SECONDS, type MicroBreakDurationSeconds } from '../types';

export interface PongVec2 {
  readonly x: number;
  readonly y: number;
}

export interface PongEngineConfig {
  readonly width: number;
  readonly height: number;
  readonly paddleWidth: number;
  readonly paddleHeight: number;
  readonly paddleY: number; // top edge of the paddle rect
  readonly ballRadius: number;
  readonly baseSpeed: number; // px/s at game start
  readonly maxSpeed: number; // px/s hard cap (progressive speed ceiling)
  readonly speedRampPerHit: number; // multiplier applied to speed on each paddle hit
  readonly maxBounceAngleRad: number; // degenerate-angle prevention bound -- must stay < Math.PI / 2
  readonly durationSeconds: MicroBreakDurationSeconds;
}

export const DEFAULT_PONG_CONFIG: PongEngineConfig = {
  width: 400,
  height: 600,
  paddleWidth: 90,
  paddleHeight: 14,
  paddleY: 560,
  ballRadius: 8,
  baseSpeed: 220,
  maxSpeed: 640,
  speedRampPerHit: 1.045,
  maxBounceAngleRad: (60 * Math.PI) / 180,
  durationSeconds: DEFAULT_MICRO_BREAK_DURATION_SECONDS,
};

export type PongStatus = 'playing' | 'ended';

export interface PongState {
  readonly ball: PongVec2;
  readonly ballVelocity: PongVec2; // px/s
  readonly paddleX: number; // paddle center x
  readonly score: number;
  readonly elapsedSeconds: number;
  readonly status: PongStatus;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function magnitude(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
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
    elapsedSeconds: 0,
    status: 'playing',
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
    const speed = Math.min(magnitude(vx, vy) * config.speedRampPerHit, config.maxSpeed);
    vx = speed * Math.sin(angle);
    vy = -speed * Math.cos(angle);
    score += 1;
  }

  // ADR-0014 §7: "no lives" -- a missed paddle still just bounces off the
  // floor; the fixed-duration timer is the only end condition.
  if (!hitPaddle && y + r > config.height) {
    y = config.height - r;
    vy = -Math.abs(vy);
  }

  const elapsedSeconds = state.elapsedSeconds + dt;
  const status: PongStatus = elapsedSeconds >= config.durationSeconds ? 'ended' : 'playing';

  return {
    ball: { x, y },
    ballVelocity: { x: vx, y: vy },
    paddleX: state.paddleX,
    score,
    elapsedSeconds,
    status,
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
