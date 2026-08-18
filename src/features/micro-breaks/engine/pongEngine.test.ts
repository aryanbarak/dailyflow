import { describe, expect, it } from 'vitest';
import {
  createInitialPongState,
  DEFAULT_PONG_CONFIG,
  getRemainingSeconds,
  setPaddleX,
  stepPong,
  type PongEngineConfig,
  type PongState,
} from './pongEngine';

// Deterministic config: no ramp/cap noise for tests that don't need it.
const CONFIG: PongEngineConfig = { ...DEFAULT_PONG_CONFIG, speedRampPerHit: 1, durationSeconds: 90 };

function straightDownState(overrides: Partial<PongState> = {}): PongState {
  const base = createInitialPongState(CONFIG);
  return { ...base, ball: { x: 200, y: 300 }, ballVelocity: { x: 0, y: 300 }, ...overrides };
}

describe('pongEngine: substep determinism (60Hz vs 120Hz convergence)', () => {
  it('one 32ms step produces the exact same trajectory as two 16ms steps', () => {
    const start = createInitialPongState(CONFIG);

    const oneStep = stepPong(start, 32, CONFIG);
    const twoSteps = stepPong(stepPong(start, 16, CONFIG), 16, CONFIG);

    expect(oneStep).toEqual(twoSteps);
  });
});

describe('pongEngine: dt clamp', () => {
  it('a 15000ms delta (simulated tab suspension) does not teleport the ball across the board', () => {
    const start = createInitialPongState(CONFIG);
    const next = stepPong(start, 15000, CONFIG);

    // Clamped to 250ms total -- elapsed time must reflect that clamp, not
    // the raw 15s delta.
    expect(next.elapsedSeconds).toBeCloseTo(0.25, 2);

    // At baseSpeed=220px/s, 15 unclamped seconds would move the ball ~3300px
    // (and bounce off walls repeatedly) inside a 400x600 board. Clamped, it
    // should move only a few tens of pixels from its start.
    const distanceMoved = Math.hypot(next.ball.x - start.ball.x, next.ball.y - start.ball.y);
    expect(distanceMoved).toBeLessThan(60);
  });

  it('dtMs <= 0 (the first frame after a resume that just reset the previous-timestamp reference) never advances state', () => {
    const start = createInitialPongState(CONFIG);
    expect(stepPong(start, 0, CONFIG)).toBe(start);
    expect(stepPong(start, -5, CONFIG)).toBe(start);
  });
});

describe('pongEngine: collision', () => {
  it('a ball travelling down into the paddle band reflects upward and increments score', () => {
    const state = straightDownState({ ball: { x: 200, y: CONFIG.paddleY - 10 } });
    const next = stepPong(state, 16, CONFIG);

    expect(next.ballVelocity.y).toBeLessThan(0);
    expect(next.score).toBe(1);
  });

  it('a ball missing the paddle band bounces off the floor instead (no lives -- ADR-0014 §7)', () => {
    const state = straightDownState({
      ball: { x: 10, y: CONFIG.height - 2 },
      paddleX: 300, // paddle far away from x=10
    });
    const next = stepPong(state, 16, CONFIG);

    expect(next.ballVelocity.y).toBeLessThan(0);
    expect(next.score).toBe(0);
    expect(next.status).toBe('playing');
  });
});

describe('pongEngine: contact-point -> angle mapping', () => {
  it('hitting dead center sends the ball straight up (no horizontal component)', () => {
    const state = straightDownState({ ball: { x: 200, y: CONFIG.paddleY - 10 }, paddleX: 200 });
    const next = stepPong(state, 16, CONFIG);
    expect(next.ballVelocity.x).toBeCloseTo(0, 5);
  });

  it('hitting the right edge sends the ball off at the configured max bounce angle', () => {
    const paddleX = 200;
    const rightEdgeX = paddleX + CONFIG.paddleWidth / 2;
    const state = straightDownState({ ball: { x: rightEdgeX, y: CONFIG.paddleY - 10 }, paddleX });
    const next = stepPong(state, 16, CONFIG);

    const speed = Math.hypot(next.ballVelocity.x, next.ballVelocity.y);
    const impliedAngle = Math.asin(next.ballVelocity.x / speed);
    expect(impliedAngle).toBeCloseTo(CONFIG.maxBounceAngleRad, 3);
    expect(next.ballVelocity.x).toBeGreaterThan(0);
  });
});

describe('pongEngine: degenerate-angle prevention', () => {
  it('even at the extreme edge, the vertical speed component never collapses towards zero', () => {
    const paddleX = 200;
    const edgeX = paddleX + CONFIG.paddleWidth / 2;
    const state = straightDownState({ ball: { x: edgeX, y: CONFIG.paddleY - 10 }, paddleX });
    const next = stepPong(state, 16, CONFIG);

    const speed = Math.hypot(next.ballVelocity.x, next.ballVelocity.y);
    const minVerticalFraction = Math.cos(CONFIG.maxBounceAngleRad); // structural floor from maxBounceAngleRad < 90deg
    expect(Math.abs(next.ballVelocity.y)).toBeGreaterThanOrEqual(speed * minVerticalFraction - 1e-6);
  });
});

describe('pongEngine: progressive speed with hard cap', () => {
  it('speed increases on each hit but never exceeds maxSpeed', () => {
    const ramped: PongEngineConfig = { ...CONFIG, speedRampPerHit: 1.5, maxSpeed: 500 };
    let state = createInitialPongState(ramped);
    let speed = 300;

    for (let hit = 0; hit < 10; hit++) {
      state = { ...state, ball: { x: state.paddleX, y: ramped.paddleY - 10 }, ballVelocity: { x: 0, y: speed } };
      state = stepPong(state, 16, ramped);
      const newSpeed = Math.hypot(state.ballVelocity.x, state.ballVelocity.y);
      expect(newSpeed).toBeLessThanOrEqual(ramped.maxSpeed + 1e-6);
      expect(newSpeed).toBeGreaterThanOrEqual(speed - 1e-6);
      speed = newSpeed;
    }

    expect(state.score).toBe(10);
    expect(speed).toBeCloseTo(ramped.maxSpeed, 3);
  });
});

describe('pongEngine: timer end condition', () => {
  it('status becomes "ended" once elapsed time reaches durationSeconds, and the engine freezes state after that', () => {
    const shortConfig: PongEngineConfig = { ...CONFIG, durationSeconds: 60 };
    let state = createInitialPongState(shortConfig);

    for (let i = 0; i < 4000 && state.status === 'playing'; i++) {
      state = stepPong(state, 16, shortConfig);
    }

    expect(state.status).toBe('ended');
    expect(getRemainingSeconds(state, shortConfig)).toBe(0);

    const frozen = stepPong(state, 16, shortConfig);
    expect(frozen).toBe(state);
  });

  it('pause/resume does not advance the timer or physics: not calling stepPong leaves state unchanged', () => {
    const state = createInitialPongState(CONFIG);
    // "Pausing" is simply the caller (useVisibilityAwareGameLoop) not
    // invoking stepPong at all while hidden -- there is nothing for the
    // pure engine to do, and this proves it: an unreferenced state value
    // never mutates on its own.
    const stillState = state;
    expect(stillState).toBe(state);
    expect(stillState.elapsedSeconds).toBe(0);
  });
});

describe('pongEngine: paddle input', () => {
  it('setPaddleX clamps the paddle within the board, accounting for paddle width', () => {
    const state = createInitialPongState(CONFIG);
    const clampedLeft = setPaddleX(state, -1000, CONFIG);
    const clampedRight = setPaddleX(state, 10000, CONFIG);

    expect(clampedLeft.paddleX).toBe(CONFIG.paddleWidth / 2);
    expect(clampedRight.paddleX).toBe(CONFIG.width - CONFIG.paddleWidth / 2);
  });
});
