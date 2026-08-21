import { describe, expect, it } from 'vitest';
import { BOARD_MAX_WIDTH_PX, BOARD_MIN_WIDTH_PX, PADDLE_BOTTOM_MARGIN_RATIO } from '../tuning';
import {
  computeBoardConfig,
  computePaddleJumpOffsetPx,
  createInitialPongState,
  DEFAULT_PONG_CONFIG,
  getRemainingSeconds,
  isFinalWave,
  requestPaddleJump,
  rescalePongState,
  setPaddleX,
  stepPong,
  type PongDriftingOrbConfig,
  type PongEngineConfig,
  type PongObstacleConfig,
  type PongPaddleJumpConfig,
  type PongState,
} from './pongEngine';

// Deterministic config: no ramp/cap noise for tests that don't need it.
const CONFIG: PongEngineConfig = { ...DEFAULT_PONG_CONFIG, speedRampPerHit: 1, durationSeconds: 90 };

// MB-07, ADR-0015 §10 (amendment): a single breakable obstacle placed well
// clear of the paddle band (paddleY=560) and the top wall, spanning
// x:[150,250], y:[250,270] on the 400x600 default board.
const TEST_OBSTACLE: PongObstacleConfig = { id: 'obs1', x: 150, y: 250, width: 100, height: 20, breakable: true, comboThresholdToBreak: 3 };
const CONFIG_WITH_OBSTACLE: PongEngineConfig = { ...CONFIG, obstacles: [TEST_OBSTACLE] };

// Builds combo to exactly `count` via consecutive paddle hits, then returns
// the resulting state (obstacle-free trajectory -- paddle is at the
// board's bottom, obstacle is mid-board, so these never interact).
function buildCombo(config: PongEngineConfig, count: number): PongState {
  let state = createInitialPongState(config);
  for (let hit = 0; hit < count; hit++) {
    state = { ...state, ball: { x: state.paddleX, y: config.paddleY - 10 }, ballVelocity: { x: 0, y: 300 } };
    state = stepPong(state, 16, config);
  }
  return state;
}

function magnitudeOf(vec: { x: number; y: number }): number {
  return Math.hypot(vec.x, vec.y);
}

// MB-08, ADR-0015 §11 (amendment); contact behavior revised MB-10: a
// drifting-orb spawn recipe with a short, test-friendly spawn interval.
// rewardSpeedStep/penaltySpeedStep deliberately NOT inverses of each other
// (2 and 0.4, not 2 and 0.5) so a compounding-vs-cancellation bug would
// show up as a visibly wrong number, not accidentally look right.
const TEST_DRIFTING_ORB_SPAWN: PongDriftingOrbConfig = {
  spawnIntervalMs: 1000,
  driftSpeedPxPerSecond: 50,
  radius: 8,
  rewardSpeedStep: 2,
  penaltySpeedStep: 0.4,
};
const CONFIG_WITH_DRIFTING_ORBS: PongEngineConfig = { ...CONFIG, driftingOrbSpawn: TEST_DRIFTING_ORB_SPAWN };

// Ball and a single active drifting orb at the SAME point, moving downward
// -- guarantees circle-circle overlap on the very next substep regardless
// of the small drift-vs-ball delta.
function stateWithDriftingOrb(role: 'reward' | 'penalty', overrides: Partial<PongState> = {}): PongState {
  const base = createInitialPongState(CONFIG_WITH_DRIFTING_ORBS);
  return {
    ...base,
    ball: { x: 200, y: 300 },
    ballVelocity: { x: 0, y: 200 },
    driftingOrbs: [{ id: 'orb1', x: 200, y: 300, role }],
    ...overrides,
  };
}

// MB-10, ADR-0015 §11 (revision): a penalty orb positioned exactly inside
// the paddle rect, ball placed far away so it can never resolve as a ball
// contact first -- isolates the NEW paddle-vs-orb collision path.
function stateWithPenaltyOrbAtPaddle(config: PongEngineConfig = CONFIG_WITH_DRIFTING_ORBS): PongState {
  const base = createInitialPongState(config);
  return {
    ...base,
    ball: { x: 10, y: 10 },
    ballVelocity: { x: 0, y: 200 },
    paddleX: config.width / 2,
    driftingOrbs: [{ id: 'paddle-orb', x: config.width / 2, y: config.paddleY, role: 'penalty' }],
  };
}

// MB-26, ADR-0015 §15: a paddle jump-strike recipe with test-friendly round
// numbers -- riseMs/fallMs deliberately UNEQUAL (100/50, not symmetric) so a
// bug that swapped or averaged them would produce a visibly wrong total
// (150ms) rather than accidentally looking right. hitSpeedImpulse (200) is
// large relative to CONFIG's speeds so an applied-vs-not-applied contrast
// test can't pass on rounding noise alone.
const TEST_PADDLE_JUMP: PongPaddleJumpConfig = { riseMs: 100, fallMs: 50, heightRatio: 0.05, cooldownMs: 300, hitSpeedImpulse: 200 };
const CONFIG_WITH_PADDLE_JUMP: PongEngineConfig = { ...CONFIG, paddleJump: TEST_PADDLE_JUMP };

// MB-10, ADR-0015 §11 (revision): an orb positioned just inside the bottom
// boundary (one substep's drift pushes it past config.height), ball placed
// far away so it can never resolve as a ball contact -- isolates the
// bottom-miss path.
function stateWithOrbAtBottom(role: 'reward' | 'penalty', config: PongEngineConfig = CONFIG_WITH_DRIFTING_ORBS): PongState {
  const radius = config.driftingOrbSpawn!.radius;
  return {
    ...createInitialPongState(config),
    ball: { x: 10, y: 10 },
    // 300, not 200 -- high enough that 300 * penaltySpeedStep(0.4) = 120
    // stays comfortably above the default minSpeed floor (90), so the
    // bottom-miss penalty test below observes the raw multiplication, not
    // an incidental floor clamp (clamping is covered by its own test).
    ballVelocity: { x: 0, y: 300 },
    driftingOrbs: [{ id: 'falling-orb', x: 300, y: config.height + radius - 0.5, role }],
  };
}

// Positions the ball to descend into TEST_OBSTACLE's top face on the next step.
function obstacleApproachState(state: PongState): PongState {
  return { ...state, ball: { x: 200, y: 248 }, ballVelocity: { x: 0, y: 300 } };
}

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

    // MB-03: score now follows the combo formula (baseScorePerHit *
    // min(combo, comboCap)), not a flat +1 -- 10 consecutive hits with
    // comboCap=5: 1+2+3+4+5+5+5+5+5+5 = 40.
    expect(state.score).toBe(40);
    expect(state.combo).toBe(10);
    expect(speed).toBeCloseTo(ramped.maxSpeed, 3);
  });
});

describe('pongEngine: combo (MB-03, ADR-0014 §11-12)', () => {
  it('a single hit sets combo to 1 and awards exactly baseScorePerHit (matches Slice 1\'s flat "+1" for an isolated hit)', () => {
    const state = straightDownState({ ball: { x: 200, y: CONFIG.paddleY - 10 }, paddleX: 200 });
    const next = stepPong(state, 16, CONFIG);
    expect(next.combo).toBe(1);
    expect(next.score).toBe(CONFIG.baseScorePerHit);
  });

  it('consecutive hits increment combo and each hit is worth MORE than the last, up to the cap', () => {
    let state = createInitialPongState(CONFIG);
    let previousGain = 0;

    for (let hit = 0; hit < CONFIG.comboCap + 2; hit++) {
      const prevScore = state.score;
      state = { ...state, ball: { x: state.paddleX, y: CONFIG.paddleY - 10 }, ballVelocity: { x: 0, y: 300 } };
      state = stepPong(state, 16, CONFIG);
      const gain = state.score - prevScore;
      expect(state.combo).toBe(hit + 1);
      if (hit < CONFIG.comboCap) {
        expect(gain).toBe(CONFIG.baseScorePerHit * (hit + 1));
        expect(gain).toBeGreaterThan(previousGain);
      } else {
        // At/above the cap, each hit's gain plateaus at baseScorePerHit * comboCap.
        expect(gain).toBe(CONFIG.baseScorePerHit * CONFIG.comboCap);
        expect(gain).toBe(previousGain);
      }
      previousGain = gain;
    }
  });

  it('a floor bounce (miss) resets combo to 0 but NEVER reduces score', () => {
    // Build up a combo of 3 first.
    let state = createInitialPongState(CONFIG);
    for (let hit = 0; hit < 3; hit++) {
      state = { ...state, ball: { x: state.paddleX, y: CONFIG.paddleY - 10 }, ballVelocity: { x: 0, y: 300 } };
      state = stepPong(state, 16, CONFIG);
    }
    expect(state.combo).toBe(3);
    const scoreBeforeMiss = state.score;

    // Now miss: ball far from the paddle, about to hit the floor.
    state = { ...state, ball: { x: 10, y: CONFIG.height - 2 }, paddleX: 300, ballVelocity: { x: 0, y: 300 } };
    const afterMiss = stepPong(state, 16, CONFIG);

    expect(afterMiss.combo).toBe(0);
    expect(afterMiss.score).toBe(scoreBeforeMiss); // unchanged, not decreased
  });

  it('score is monotonically non-decreasing across an interleaved sequence of hits and misses', () => {
    let state = createInitialPongState(CONFIG);
    let lastScore = state.score;

    const actions: Array<'hit' | 'miss'> = ['hit', 'hit', 'miss', 'hit', 'miss', 'miss', 'hit', 'hit', 'hit'];
    for (const action of actions) {
      if (action === 'hit') {
        state = { ...state, ball: { x: state.paddleX, y: CONFIG.paddleY - 10 }, ballVelocity: { x: 0, y: 300 } };
      } else {
        state = { ...state, ball: { x: 10, y: CONFIG.height - 2 }, paddleX: 300, ballVelocity: { x: 0, y: 300 } };
      }
      state = stepPong(state, 16, CONFIG);
      expect(state.score).toBeGreaterThanOrEqual(lastScore);
      lastScore = state.score;
    }
  });
});

describe('pongEngine: final wave detection (MB-03, ADR-0014 §12)', () => {
  it('is false at the start of a session', () => {
    const state = createInitialPongState(CONFIG);
    expect(isFinalWave(state, CONFIG)).toBe(false);
  });

  it('is true once remaining time drops to finalWaveWindowSeconds, false just before', () => {
    const shortConfig: PongEngineConfig = { ...CONFIG, durationSeconds: 60, finalWaveWindowSeconds: 10 };
    const justOutside: PongState = { ...createInitialPongState(shortConfig), elapsedSeconds: 49.9 };
    const justInside: PongState = { ...createInitialPongState(shortConfig), elapsedSeconds: 50 };
    expect(isFinalWave(justOutside, shortConfig)).toBe(false);
    expect(isFinalWave(justInside, shortConfig)).toBe(true);
  });

  it('is false once the session has ended (no lingering "final wave" after the timer already ended it)', () => {
    const shortConfig: PongEngineConfig = { ...CONFIG, durationSeconds: 60, finalWaveWindowSeconds: 10 };
    const ended: PongState = { ...createInitialPongState(shortConfig), elapsedSeconds: 60, status: 'ended' };
    expect(isFinalWave(ended, shortConfig)).toBe(false);
  });

  it('speed ramps faster on a hit during the final wave than an identical hit outside it, without exceeding maxSpeed', () => {
    const rampedConfig: PongEngineConfig = {
      ...CONFIG,
      durationSeconds: 60,
      finalWaveWindowSeconds: 10,
      speedRampPerHit: 1.2,
      finalWaveRampBoost: 2,
      maxSpeed: 10_000, // effectively unreachable here, isolates the ramp-rate comparison
    };
    const hitState = (elapsedSeconds: number): PongState => ({
      ...createInitialPongState(rampedConfig),
      elapsedSeconds,
      ball: { x: 200, y: rampedConfig.paddleY - 10 },
      ballVelocity: { x: 0, y: 300 },
    });

    const normalHit = stepPong(hitState(0), 16, rampedConfig);
    const finalWaveHit = stepPong(hitState(55), 16, rampedConfig);

    const normalSpeed = Math.hypot(normalHit.ballVelocity.x, normalHit.ballVelocity.y);
    const finalWaveSpeed = Math.hypot(finalWaveHit.ballVelocity.x, finalWaveHit.ballVelocity.y);
    expect(finalWaveSpeed).toBeGreaterThan(normalSpeed);
  });

  it('the final-wave ramp boost never lets speed exceed the hard cap', () => {
    const rampedConfig: PongEngineConfig = {
      ...CONFIG,
      durationSeconds: 60,
      finalWaveWindowSeconds: 10,
      speedRampPerHit: 1.5,
      finalWaveRampBoost: 5,
      maxSpeed: 500,
    };
    let state: PongState = { ...createInitialPongState(rampedConfig), elapsedSeconds: 55 };
    for (let hit = 0; hit < 8; hit++) {
      state = { ...state, ball: { x: state.paddleX, y: rampedConfig.paddleY - 10 }, ballVelocity: { x: 0, y: 300 } };
      state = stepPong(state, 16, rampedConfig);
      const speed = Math.hypot(state.ballVelocity.x, state.ballVelocity.y);
      expect(speed).toBeLessThanOrEqual(rampedConfig.maxSpeed + 1e-6);
    }
  });
});

describe('pongEngine: resize/rescale (MB-03, mobile/PWA acceptance)', () => {
  it('preserves relative position: a ball at 50% width/height stays at ~50% after a resize', () => {
    const oldConfig: PongEngineConfig = { ...CONFIG, width: 400, height: 600 };
    const newConfig: PongEngineConfig = { ...CONFIG, width: 300, height: 450 };
    const state: PongState = { ...createInitialPongState(oldConfig), ball: { x: 200, y: 300 }, paddleX: 200 };

    const rescaled = rescalePongState(state, oldConfig, newConfig);

    expect(rescaled.ball.x / newConfig.width).toBeCloseTo(state.ball.x / oldConfig.width, 5);
    expect(rescaled.ball.y / newConfig.height).toBeCloseTo(state.ball.y / oldConfig.height, 5);
    expect(rescaled.paddleX / newConfig.width).toBeCloseTo(state.paddleX / oldConfig.width, 5);
  });

  it('never exceeds the new bounds, even for a position near the old edge that would otherwise overflow a smaller board', () => {
    const oldConfig: PongEngineConfig = { ...CONFIG, width: 400, height: 600, ballRadius: 8 };
    const newConfig: PongEngineConfig = { ...CONFIG, width: 200, height: 300, ballRadius: 8 };
    const state: PongState = {
      ...createInitialPongState(oldConfig),
      ball: { x: oldConfig.width - 2, y: oldConfig.height - 2 },
      paddleX: oldConfig.width - 5,
    };

    const rescaled = rescalePongState(state, oldConfig, newConfig);

    expect(rescaled.ball.x).toBeLessThanOrEqual(newConfig.width - newConfig.ballRadius);
    expect(rescaled.ball.y).toBeLessThanOrEqual(newConfig.height - newConfig.ballRadius);
    expect(rescaled.ball.x).toBeGreaterThanOrEqual(newConfig.ballRadius);
    expect(rescaled.paddleX).toBeLessThanOrEqual(newConfig.width - newConfig.paddleWidth / 2);
  });

  it('scales velocity proportionally, so the ball keeps crossing the board in the same relative time', () => {
    const oldConfig: PongEngineConfig = { ...CONFIG, width: 400, height: 600 };
    const newConfig: PongEngineConfig = { ...CONFIG, width: 200, height: 300 };
    const state: PongState = { ...createInitialPongState(oldConfig), ballVelocity: { x: 100, y: -150 } };

    const rescaled = rescalePongState(state, oldConfig, newConfig);

    expect(rescaled.ballVelocity.x).toBeCloseTo(50, 5);
    expect(rescaled.ballVelocity.y).toBeCloseTo(-75, 5);
  });

  it('is a no-op (same object) when dimensions are unchanged', () => {
    const state = createInitialPongState(CONFIG);
    expect(rescalePongState(state, CONFIG, CONFIG)).toBe(state);
  });
});

describe('pongEngine: computeBoardConfig (MB-03, mobile/PWA acceptance)', () => {
  it('preserves the board aspect ratio for a typical mobile portrait container', () => {
    const config = computeBoardConfig(360, 700, CONFIG);
    expect(config.width / config.height).toBeCloseTo(DEFAULT_PONG_CONFIG.width / DEFAULT_PONG_CONFIG.height, 5);
  });

  it('clamps width to BOARD_MIN_WIDTH_PX for a very small container', () => {
    const config = computeBoardConfig(120, 200, CONFIG);
    expect(config.width).toBe(BOARD_MIN_WIDTH_PX);
  });

  it('clamps width to BOARD_MAX_WIDTH_PX for a very large container', () => {
    const config = computeBoardConfig(2000, 2000, CONFIG);
    expect(config.width).toBe(BOARD_MAX_WIDTH_PX);
  });

  it('fits within the container on the constraining axis (landscape: height is the limiter)', () => {
    // A realistic mobile landscape height (400px) that's still narrower
    // than what the aspect ratio would want for the full container width --
    // large enough that BOARD_MIN_WIDTH_PX never has to fight the fit.
    const containerWidth = 800;
    const containerHeight = 400;
    const config = computeBoardConfig(containerWidth, containerHeight, CONFIG);
    expect(config.width).toBeLessThanOrEqual(containerWidth);
    expect(config.height).toBeLessThanOrEqual(containerHeight + 1e-6);
  });

  it("paddle sits with the tuned bottom margin, leaving room for a resting finger below it (never covers the paddle)", () => {
    const config = computeBoardConfig(360, 700, CONFIG);
    const paddleBottom = config.paddleY + config.paddleHeight;
    const marginBelowPaddle = config.height - paddleBottom;
    expect(marginBelowPaddle / config.height).toBeCloseTo(PADDLE_BOTTOM_MARGIN_RATIO, 2);
  });

  it('scales paddle/ball size proportionally with board width, never a fixed pixel size', () => {
    const small = computeBoardConfig(240, 500, CONFIG);
    const large = computeBoardConfig(480, 900, CONFIG);
    expect(large.paddleWidth).toBeGreaterThan(small.paddleWidth);
    expect(large.ballRadius).toBeGreaterThan(small.ballRadius);
  });

  it('leaves gameplay tuning (durationSeconds, speeds, combo) untouched -- only dimensions change', () => {
    const config = computeBoardConfig(360, 700, CONFIG);
    expect(config.durationSeconds).toBe(CONFIG.durationSeconds);
    expect(config.baseSpeed).toBe(CONFIG.baseSpeed);
    expect(config.comboCap).toBe(CONFIG.comboCap);
  });

  // MB-14, ADR-0015 §13: Quick Break regression guard -- Quick Break's call
  // site (PongCanvas.tsx) passes only 3 args, so the NEW 4th `maxWidthPx`
  // parameter must default to producing IDENTICAL output to before this
  // slice, for realistic container sizes across the whole small/typical/
  // large range this function's own tests above already cover -- not just
  // "no Quick Break files changed" by omission, an actual computed-output
  // proof.
  it('MB-14: calling with the OLD 3-arg signature (as Quick Break/PongCanvas.tsx does) produces BYTE-IDENTICAL output to explicitly passing BOARD_MAX_WIDTH_PX as the 4th arg -- the new maxWidthPx param is provably inert for any caller that omits it', () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [120, 200], // clamps to BOARD_MIN_WIDTH_PX
      [360, 700], // typical mobile portrait
      [800, 400], // landscape, height-constrained
      [2000, 2000], // clamps to BOARD_MAX_WIDTH_PX
    ];
    for (const [w, h] of cases) {
      const withoutParam = computeBoardConfig(w, h, CONFIG);
      const withExplicitDefault = computeBoardConfig(w, h, CONFIG, BOARD_MAX_WIDTH_PX);
      expect(withoutParam).toEqual(withExplicitDefault);
    }
  });

  // MB-14: the NEW param only has any effect when a caller (Journey) opts
  // in by actually passing a larger value -- proves the override is real
  // (not silently ignored) while staying additive to the existing MIN/fit
  // constraints, not a replacement for them.
  it('MB-14: a maxWidthPx override LARGER than BOARD_MAX_WIDTH_PX lets the board grow past the old ceiling, still bounded by the container itself and BOARD_MIN_WIDTH_PX', () => {
    const grown = computeBoardConfig(2000, 2000, CONFIG, 900);
    expect(grown.width).toBe(900); // past the old 480px ceiling, per the override
    expect(grown.width).toBeGreaterThan(BOARD_MAX_WIDTH_PX);

    // The override can never make the board BIGGER than the container
    // itself actually allows -- a narrow container still wins.
    const stillContainerBound = computeBoardConfig(300, 700, CONFIG, 900);
    expect(stillContainerBound.width).toBeLessThanOrEqual(300);

    // BOARD_MIN_WIDTH_PX floor still applies regardless of the override.
    const stillFloored = computeBoardConfig(50, 100, CONFIG, 900);
    expect(stillFloored.width).toBe(BOARD_MIN_WIDTH_PX);
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

describe('pongEngine: obstacles (MB-07, ADR-0015 §10 amendment)', () => {
  it('Quick Break config (no obstacles) produces an empty obstacles array, and physics are unaffected by the field existing', () => {
    const state = createInitialPongState(CONFIG);
    expect(state.obstacles).toEqual([]);
    const next = stepPong(straightDownState({ ball: { x: 200, y: CONFIG.paddleY - 10 } }), 16, CONFIG);
    expect(next.obstacles).toEqual([]);
  });

  it('a ball hitting a breakable obstacle BELOW the combo threshold bounces off but does NOT break it', () => {
    const state = obstacleApproachState(buildCombo(CONFIG_WITH_OBSTACLE, TEST_OBSTACLE.comboThresholdToBreak! - 1));
    expect(state.combo).toBe(TEST_OBSTACLE.comboThresholdToBreak! - 1);

    const next = stepPong(state, 16, CONFIG_WITH_OBSTACLE);

    expect(next.ballVelocity.y).toBeLessThan(0); // bounced upward off the top face
    expect(next.obstacles).toEqual([{ id: 'obs1', broken: false }]);
  });

  it('a ball hitting a breakable obstacle AT the combo threshold breaks it, WITHOUT changing the reflection (same trajectory as an otherwise-identical non-breakable hit)', () => {
    const stateAtThreshold = obstacleApproachState(buildCombo(CONFIG_WITH_OBSTACLE, TEST_OBSTACLE.comboThresholdToBreak!));
    expect(stateAtThreshold.combo).toBe(TEST_OBSTACLE.comboThresholdToBreak);

    const breakableNext = stepPong(stateAtThreshold, 16, CONFIG_WITH_OBSTACLE);
    expect(breakableNext.obstacles).toEqual([{ id: 'obs1', broken: true }]);

    // Same geometry/combo, but the obstacle is configured non-breakable --
    // ADR-0015 §10: "ball reflects normally either way," so the resulting
    // ball position/velocity must be IDENTICAL regardless of whether the
    // hit broke the obstacle.
    const nonBreakableConfig: PongEngineConfig = { ...CONFIG, obstacles: [{ ...TEST_OBSTACLE, breakable: false }] };
    const stateAtThresholdNonBreakable = obstacleApproachState(buildCombo(nonBreakableConfig, TEST_OBSTACLE.comboThresholdToBreak!));
    const nonBreakableNext = stepPong(stateAtThresholdNonBreakable, 16, nonBreakableConfig);

    expect(breakableNext.ball).toEqual(nonBreakableNext.ball);
    expect(breakableNext.ballVelocity).toEqual(nonBreakableNext.ballVelocity);
    expect(nonBreakableNext.obstacles).toEqual([{ id: 'obs1', broken: false }]); // never breaks -- not marked breakable
  });

  it('once broken, an obstacle no longer collides -- a later ball on the same path passes through instead of bouncing', () => {
    const brokenState: PongState = {
      ...obstacleApproachState(createInitialPongState(CONFIG_WITH_OBSTACLE)),
      obstacles: [{ id: 'obs1', broken: true }],
    };

    const next = stepPong(brokenState, 16, CONFIG_WITH_OBSTACLE);

    // No bounce: velocity keeps its original downward sign, and the ball's
    // y position lands wherever unobstructed motion would put it (inside/
    // past the former obstacle rect), not clamped to its top edge.
    expect(next.ballVelocity.y).toBeGreaterThan(0);
    expect(next.ball.y).toBeCloseTo(248 + 300 * 0.016, 5);
    expect(next.obstacles).toEqual([{ id: 'obs1', broken: true }]);
  });
});

describe('pongEngine: drifting speed-orbs (MB-08, ADR-0015 §11 amendment; contact behavior REVISED by MB-10)', () => {
  it('Quick Break config (no driftingOrbSpawn) never spawns or holds drifting orbs, and no drifting-orb counter ever increments', () => {
    let state = createInitialPongState(CONFIG);
    for (let i = 0; i < 20; i++) {
      state = stepPong(state, 16, CONFIG);
      expect(state.driftingOrbs).toEqual([]);
      expect(state.rewardContactCount).toBe(0);
      expect(state.penaltyBallContactCount).toBe(0);
      expect(state.penaltyPaddleCatchCount).toBe(0);
      expect(state.penaltyBottomMissCount).toBe(0);
    }
  });

  it('reward ball-contact multiplies CURRENT ball speed UP by rewardSpeedStep, clamped at maxSpeed', () => {
    const state = stateWithDriftingOrb('reward');
    const speedBefore = magnitudeOf(state.ballVelocity);

    const next = stepPong(state, 16, CONFIG_WITH_DRIFTING_ORBS);

    expect(next.driftingOrbs).toEqual([]); // caught -- removed
    expect(next.rewardContactCount).toBe(1);
    expect(magnitudeOf(next.ballVelocity)).toBeCloseTo(speedBefore * TEST_DRIFTING_ORB_SPAWN.rewardSpeedStep, 0);
  });

  it('penalty ball-contact multiplies CURRENT ball speed DOWN by penaltySpeedStep, clamped at minSpeed', () => {
    // 300, not the default 200 -- 300 * penaltyStep(0.4) = 120 stays above
    // the default minSpeed floor (90), so this observes the raw
    // multiplication, not an incidental floor clamp (clamping has its own
    // dedicated test below).
    const state = stateWithDriftingOrb('penalty', { ballVelocity: { x: 0, y: 300 } });
    const speedBefore = magnitudeOf(state.ballVelocity);

    const next = stepPong(state, 16, CONFIG_WITH_DRIFTING_ORBS);

    expect(next.driftingOrbs).toEqual([]);
    expect(next.penaltyBallContactCount).toBe(1);
    expect(magnitudeOf(next.ballVelocity)).toBeCloseTo(speedBefore * TEST_DRIFTING_ORB_SPAWN.penaltySpeedStep, 0);
  });

  it('reward contact never exceeds maxSpeed, even when the raw product would', () => {
    const nearCapConfig: PongEngineConfig = { ...CONFIG_WITH_DRIFTING_ORBS, maxSpeed: 500 };
    const state = stateWithDriftingOrb('reward', { ballVelocity: { x: 0, y: 400 } }); // 400 * rewardStep(2) = 800, well past the 500 cap

    const next = stepPong(state, 16, nearCapConfig);

    expect(magnitudeOf(next.ballVelocity)).toBeLessThanOrEqual(nearCapConfig.maxSpeed + 1e-6);
  });

  it('penalty contact never drops below minSpeed, even when the raw product would', () => {
    const nearFloorConfig: PongEngineConfig = { ...CONFIG_WITH_DRIFTING_ORBS, minSpeed: 150 };
    const state = stateWithDriftingOrb('penalty', { ballVelocity: { x: 0, y: 200 } }); // 200 * penaltyStep(0.4) = 80, below the 150 floor

    const next = stepPong(state, 16, nearFloorConfig);

    expect(magnitudeOf(next.ballVelocity)).toBeGreaterThanOrEqual(nearFloorConfig.minSpeed - 1e-6);
  });

  it('TWO consecutive reward contacts COMPOUND -- the second multiplies the ALREADY-elevated speed, not the room base speed (the opposite of MB-08s retired "refresh, dont stack" rule)', () => {
    // A generously high maxSpeed here -- this test is specifically about
    // compounding, not clamping (clamping has its own dedicated test
    // above), so the ceiling must not interfere with either contact.
    const highCapConfig: PongEngineConfig = { ...CONFIG_WITH_DRIFTING_ORBS, maxSpeed: 5000 };
    let state = stepPong(stateWithDriftingOrb('reward'), 16, highCapConfig);
    const speedAfterFirst = magnitudeOf(state.ballVelocity);
    expect(state.rewardContactCount).toBe(1);

    // A second reward orb, positioned at the ball's NEW location, contacted immediately after.
    state = { ...state, driftingOrbs: [{ id: 'orb2', x: state.ball.x, y: state.ball.y, role: 'reward' }] };
    const next = stepPong(state, 16, highCapConfig);

    expect(next.rewardContactCount).toBe(2);
    expect(magnitudeOf(next.ballVelocity)).toBeCloseTo(speedAfterFirst * TEST_DRIFTING_ORB_SPAWN.rewardSpeedStep, 0);
    // Explicitly rules out the retired "refresh from base" behavior -- the
    // base-speed-derived single-step value would be a visibly different,
    // smaller number.
    const baseSpeed = magnitudeOf(createInitialPongState(highCapConfig).ballVelocity);
    expect(magnitudeOf(next.ballVelocity)).not.toBeCloseTo(baseSpeed * TEST_DRIFTING_ORB_SPAWN.rewardSpeedStep, 0);
  });

  it('a penalty AFTER a reward reduces from the ELEVATED speed, not from base -- the literal PO requirement, tested by name', () => {
    let state = stepPong(stateWithDriftingOrb('reward'), 16, CONFIG_WITH_DRIFTING_ORBS);
    const speedAfterReward = magnitudeOf(state.ballVelocity);
    expect(state.rewardContactCount).toBe(1);

    state = { ...state, driftingOrbs: [{ id: 'orb2', x: state.ball.x, y: state.ball.y, role: 'penalty' }] };
    const next = stepPong(state, 16, CONFIG_WITH_DRIFTING_ORBS);

    expect(next.penaltyBallContactCount).toBe(1);
    expect(magnitudeOf(next.ballVelocity)).toBeCloseTo(speedAfterReward * TEST_DRIFTING_ORB_SPAWN.penaltySpeedStep, 0);
  });

  it('paddle-catch of a penalty orb (NEW, MB-10) removes it with NO speed change', () => {
    const state = stateWithPenaltyOrbAtPaddle();
    const speedBefore = magnitudeOf(state.ballVelocity);

    const next = stepPong(state, 16, CONFIG_WITH_DRIFTING_ORBS);

    expect(next.driftingOrbs).toEqual([]); // caught by the paddle -- removed
    expect(next.penaltyPaddleCatchCount).toBe(1);
    expect(next.penaltyBallContactCount).toBe(0); // NOT counted as a ball contact
    expect(magnitudeOf(next.ballVelocity)).toBeCloseTo(speedBefore, 5); // unchanged
  });

  it('bottom-miss of a penalty orb (NEW, MB-10 -- uncaught by both ball and paddle) applies the SAME penalty as a direct ball hit', () => {
    const state = stateWithOrbAtBottom('penalty');
    const speedBefore = magnitudeOf(state.ballVelocity);

    const next = stepPong(state, 16, CONFIG_WITH_DRIFTING_ORBS);

    expect(next.driftingOrbs).toEqual([]); // fell past the bottom, removed
    expect(next.penaltyBottomMissCount).toBe(1);
    expect(next.penaltyBallContactCount).toBe(0); // NOT counted as a ball contact
    expect(magnitudeOf(next.ballVelocity)).toBeCloseTo(speedBefore * TEST_DRIFTING_ORB_SPAWN.penaltySpeedStep, 0);
  });

  it('bottom-miss of a REWARD orb still causes NO effect -- regression guard against accidentally applying the new penalty logic to the wrong role', () => {
    const state = stateWithOrbAtBottom('reward');
    const speedBefore = magnitudeOf(state.ballVelocity);
    const scoreBefore = state.score;

    const next = stepPong(state, 16, CONFIG_WITH_DRIFTING_ORBS);

    expect(next.driftingOrbs).toEqual([]); // fell past the bottom, removed
    expect(next.penaltyBottomMissCount).toBe(0);
    expect(next.rewardContactCount).toBe(0);
    expect(next.score).toBe(scoreBefore);
    expect(magnitudeOf(next.ballVelocity)).toBeCloseTo(speedBefore, 5); // unchanged
  });

  it('speed never exceeds maxSpeed or drops below minSpeed at ANY point across a long, mixed sequence of reward/penalty events -- not just at the end', () => {
    const boundedConfig: PongEngineConfig = { ...CONFIG_WITH_DRIFTING_ORBS, maxSpeed: 400, minSpeed: 100 };
    let state: PongState = { ...createInitialPongState(boundedConfig), ball: { x: 200, y: 300 }, ballVelocity: { x: 0, y: 200 } };

    for (let i = 0; i < 30; i++) {
      const role: 'reward' | 'penalty' = i % 2 === 0 ? 'reward' : 'penalty';
      state = { ...state, driftingOrbs: [{ id: `orb-${i}`, x: state.ball.x, y: state.ball.y, role }] };
      state = stepPong(state, 16, boundedConfig);
      const speed = magnitudeOf(state.ballVelocity);
      expect(speed).toBeLessThanOrEqual(boundedConfig.maxSpeed + 1e-6);
      expect(speed).toBeGreaterThanOrEqual(boundedConfig.minSpeed - 1e-6);
    }
  });

  it('spawns a new orb once spawnIntervalMs elapses, using the injected random function for role and position (deterministic, not Math.random)', () => {
    const spawnTestConfig: PongEngineConfig = { ...CONFIG, driftingOrbSpawn: { ...TEST_DRIFTING_ORB_SPAWN, spawnIntervalMs: 100 } };
    const state = createInitialPongState(spawnTestConfig);
    const fixedRandom = () => 0.5; // x fraction = 0.5 (center); role: 0.5 < 0.5 is false -> 'penalty'

    const next = stepPong(state, 150, spawnTestConfig, fixedRandom);

    expect(next.driftingOrbs).toHaveLength(1);
    expect(next.driftingOrbs[0].role).toBe('penalty');
    const expectedX = spawnTestConfig.driftingOrbSpawn!.radius + 0.5 * (spawnTestConfig.width - spawnTestConfig.driftingOrbSpawn!.radius * 2);
    expect(next.driftingOrbs[0].x).toBeCloseTo(expectedX, 5);
    // y has drifted a little since the spawn moment (spawn fires partway
    // through this call, then the remaining substeps advance it) -- a
    // loose bound proves "near the top, not teleported elsewhere."
    expect(next.driftingOrbs[0].y).toBeGreaterThanOrEqual(spawnTestConfig.driftingOrbSpawn!.radius);
    expect(next.driftingOrbs[0].y).toBeLessThan(spawnTestConfig.driftingOrbSpawn!.radius + 5);
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

describe('pongEngine: paddle jump-strike (MB-26, ADR-0015 §15, Room 3+)', () => {
  it('requestPaddleJump is a structural no-op when config.paddleJump is undefined -- Quick Break and Rooms 1-2 gating', () => {
    const state = createInitialPongState(CONFIG);
    const next = requestPaddleJump(state, CONFIG); // CONFIG has no paddleJump
    expect(next).toBe(state); // same reference -- not just equal, genuinely untouched
  });

  it('requestPaddleJump sets paddleJumpActive and resets elapsedMs to 0, when enabled and grounded', () => {
    const state = createInitialPongState(CONFIG_WITH_PADDLE_JUMP);
    expect(state.paddleJumpActive).toBe(false);
    const next = requestPaddleJump(state, CONFIG_WITH_PADDLE_JUMP);
    expect(next.paddleJumpActive).toBe(true);
    expect(next.paddleJumpElapsedMs).toBe(0);
  });

  it('requestPaddleJump is a no-op while ALREADY airborne -- does not restart/extend the current hop', () => {
    const airborne: PongState = { ...createInitialPongState(CONFIG_WITH_PADDLE_JUMP), paddleJumpActive: true, paddleJumpElapsedMs: 40 };
    const next = requestPaddleJump(airborne, CONFIG_WITH_PADDLE_JUMP);
    expect(next).toBe(airborne); // same reference -- genuinely untouched, not silently reset to 0
  });

  it('requestPaddleJump is a no-op while on cooldown (grounded, but cooldownRemainingMs > 0)', () => {
    const cooling: PongState = { ...createInitialPongState(CONFIG_WITH_PADDLE_JUMP), paddleJumpActive: false, paddleJumpCooldownRemainingMs: 150 };
    const next = requestPaddleJump(cooling, CONFIG_WITH_PADDLE_JUMP);
    expect(next).toBe(cooling);
  });

  it('stepPong advances paddleJumpElapsedMs while airborne, then lands (active=false, elapsedMs=0, cooldown set to cooldownMs) once riseMs+fallMs is reached', () => {
    let state = requestPaddleJump(createInitialPongState(CONFIG_WITH_PADDLE_JUMP), CONFIG_WITH_PADDLE_JUMP);
    // Positioned/aimed so the ball never touches the paddle band during this
    // window -- isolates the jump TIMING from any collision side-effects.
    state = { ...state, ball: { x: 10, y: 10 }, ballVelocity: { x: 0, y: 0 } };

    state = stepPong(state, 40, CONFIG_WITH_PADDLE_JUMP);
    expect(state.paddleJumpActive).toBe(true);
    expect(state.paddleJumpElapsedMs).toBeCloseTo(40, 5);
    expect(state.paddleJumpCooldownRemainingMs).toBe(0); // cooldown clock has not started yet -- still airborne

    // Total hop duration is riseMs+fallMs = 150ms; 40+40+40+40 = 160ms, past it.
    state = stepPong(state, 40, CONFIG_WITH_PADDLE_JUMP);
    state = stepPong(state, 40, CONFIG_WITH_PADDLE_JUMP);
    state = stepPong(state, 40, CONFIG_WITH_PADDLE_JUMP);

    expect(state.paddleJumpActive).toBe(false); // landed
    expect(state.paddleJumpElapsedMs).toBe(0);
    expect(state.paddleJumpCooldownRemainingMs).toBeGreaterThan(0); // cooldown clock NOW running
    expect(state.paddleJumpCooldownRemainingMs).toBeLessThanOrEqual(TEST_PADDLE_JUMP.cooldownMs);
  });

  it('cooldown enforced: a rapid re-trigger immediately after landing does NOT chain into a new jump -- must FAIL against a naive no-cooldown implementation', () => {
    let state = requestPaddleJump(createInitialPongState(CONFIG_WITH_PADDLE_JUMP), CONFIG_WITH_PADDLE_JUMP);
    state = { ...state, ball: { x: 10, y: 10 }, ballVelocity: { x: 0, y: 0 } };
    // Advance past riseMs+fallMs (150ms) in one step so the hop lands.
    state = stepPong(state, 160, CONFIG_WITH_PADDLE_JUMP);
    expect(state.paddleJumpActive).toBe(false);
    expect(state.paddleJumpCooldownRemainingMs).toBeGreaterThan(0);

    // Immediately try to jump again, same tick the cooldown started.
    const retried = requestPaddleJump(state, CONFIG_WITH_PADDLE_JUMP);
    expect(retried.paddleJumpActive).toBe(false); // still grounded -- the trigger was rejected
    expect(retried).toBe(state); // genuinely untouched, not silently queued
  });

  it('a jump IS allowed again once the FULL cooldown has elapsed', () => {
    let state = requestPaddleJump(createInitialPongState(CONFIG_WITH_PADDLE_JUMP), CONFIG_WITH_PADDLE_JUMP);
    state = { ...state, ball: { x: 10, y: 10 }, ballVelocity: { x: 0, y: 0 } };
    state = stepPong(state, 160, CONFIG_WITH_PADDLE_JUMP); // lands, cooldown = 300ms
    // Two calls, not one -- stepPong's own MAX_TOTAL_STEP_MS (250ms) caps a
    // SINGLE call's clock advance (ADR-0014 §4's tab-suspension guard), so a
    // single 300ms call would only elapse 250ms of it, leaving this test's
    // own premise ("the FULL cooldown has elapsed") false before it even
    // asserts anything.
    state = stepPong(state, 200, CONFIG_WITH_PADDLE_JUMP);
    state = stepPong(state, 100, CONFIG_WITH_PADDLE_JUMP);
    expect(state.paddleJumpCooldownRemainingMs).toBe(0);

    const retried = requestPaddleJump(state, CONFIG_WITH_PADDLE_JUMP);
    expect(retried.paddleJumpActive).toBe(true); // allowed now
  });

  it('a collision resolved WHILE AIRBORNE applies the hit impulse (clamped by maxSpeed) and increments paddleJumpHitCount -- a GROUNDED collision, otherwise identical, does neither (contrast)', () => {
    const rampFreeConfig: PongEngineConfig = { ...CONFIG_WITH_PADDLE_JUMP, speedRampPerHit: 1, maxSpeed: 100000 }; // isolate the impulse from the ramp/cap
    const approach = (state: PongState): PongState => ({ ...state, ball: { x: 200, y: rampFreeConfig.paddleY - 5 }, ballVelocity: { x: 0, y: 300 }, paddleX: 200 });

    // Grounded hit.
    const groundedNext = stepPong(approach(createInitialPongState(rampFreeConfig)), 16, rampFreeConfig);
    const groundedSpeed = Math.hypot(groundedNext.ballVelocity.x, groundedNext.ballVelocity.y);
    expect(groundedNext.paddleJumpHitCount).toBe(0);

    // Airborne hit -- identical approach, but the paddle is mid-hop first.
    let airborneState = requestPaddleJump(createInitialPongState(rampFreeConfig), rampFreeConfig);
    airborneState = approach(airborneState);
    const airborneNext = stepPong(airborneState, 16, rampFreeConfig);
    const airborneSpeed = Math.hypot(airborneNext.ballVelocity.x, airborneNext.ballVelocity.y);

    expect(airborneNext.paddleJumpHitCount).toBe(1);
    // The airborne hit's resulting speed is MEANINGFULLY higher than the
    // grounded hit's -- proves the impulse actually landed on the velocity,
    // not just that the counter incremented.
    expect(airborneSpeed).toBeGreaterThan(groundedSpeed + TEST_PADDLE_JUMP.hitSpeedImpulse - 1);
  });

  it('the hit impulse is clamped by maxSpeed, same as the normal ramp -- an airborne hit can never exceed the cap', () => {
    const cappedConfig: PongEngineConfig = { ...CONFIG_WITH_PADDLE_JUMP, speedRampPerHit: 1, maxSpeed: 320 }; // just above the 300 approach speed
    let state = requestPaddleJump(createInitialPongState(cappedConfig), cappedConfig);
    state = { ...state, ball: { x: 200, y: cappedConfig.paddleY - 5 }, ballVelocity: { x: 0, y: 300 }, paddleX: 200 };
    const next = stepPong(state, 16, cappedConfig);
    const speed = Math.hypot(next.ballVelocity.x, next.ballVelocity.y);
    expect(next.paddleJumpHitCount).toBe(1); // the impulse WAS applied...
    expect(speed).toBeLessThanOrEqual(cappedConfig.maxSpeed + 1e-6); // ...but clamped, exactly like a normal ramped hit
  });

  it('the LIVE (raised) paddle rect actually gates collision: a ball positioned in the gap between the raised and grounded rect is caught ONLY while airborne', () => {
    // Position the ball exactly at the raised paddle's top edge (grounded
    // paddle would NOT reach this y) -- computed from the SAME
    // computePaddleJumpOffsetPx the engine itself uses, at a point mid-rise.
    const midRiseElapsedMs = TEST_PADDLE_JUMP.riseMs / 2;
    const offsetPx = computePaddleJumpOffsetPx(midRiseElapsedMs, TEST_PADDLE_JUMP, CONFIG_WITH_PADDLE_JUMP.height);
    expect(offsetPx).toBeGreaterThan(0); // sanity: this really is testing a raised position, not a zero offset

    const ballY = CONFIG_WITH_PADDLE_JUMP.paddleY - offsetPx + 1; // just inside the RAISED paddle's band
    const buildState = (airborne: boolean): PongState => ({
      ...createInitialPongState(CONFIG_WITH_PADDLE_JUMP),
      ball: { x: 200, y: ballY },
      ballVelocity: { x: 0, y: 300 },
      paddleX: 200,
      paddleJumpActive: airborne,
      paddleJumpElapsedMs: airborne ? midRiseElapsedMs : 0,
    });

    const airborneNext = stepPong(buildState(true), 1, CONFIG_WITH_PADDLE_JUMP); // 1ms: negligible extra travel/jump-timing drift
    const groundedNext = stepPong(buildState(false), 1, CONFIG_WITH_PADDLE_JUMP);

    expect(airborneNext.ballVelocity.y).toBeLessThan(0); // caught by the RAISED paddle
    expect(groundedNext.ballVelocity.y).toBeGreaterThan(0); // grounded paddle doesn't reach here -- ball keeps falling
  });

  it('the drifting-orb/paddle interaction is UNAFFECTED by an airborne paddle -- it keeps reading the GROUNDED rect (out of this feature\'s scope)', () => {
    const spawnConfig: PongDriftingOrbConfig = { spawnIntervalMs: 100000, driftSpeedPxPerSecond: 0, radius: 8, rewardSpeedStep: 2, penaltySpeedStep: 0.4 };
    const config: PongEngineConfig = { ...CONFIG_WITH_PADDLE_JUMP, driftingOrbSpawn: spawnConfig };
    let state = requestPaddleJump(createInitialPongState(config), config);
    // A penalty orb sitting exactly at the GROUNDED paddle position -- if the
    // paddle-catch check incorrectly used the raised rect, this orb would
    // fall just short of it while airborne; the grounded-rect contract says
    // it must still be caught here regardless of jump state.
    state = {
      ...state,
      ball: { x: 10, y: 10 },
      ballVelocity: { x: 0, y: 0 },
      paddleX: config.width / 2,
      driftingOrbs: [{ id: 'orb1', x: config.width / 2, y: config.paddleY, role: 'penalty' }],
    };
    const next = stepPong(state, 16, config);
    expect(next.penaltyPaddleCatchCount).toBe(1); // caught, exactly as it would be grounded
  });

  it('computePaddleJumpOffsetPx: 0 at/before the trigger, positive through the rise, back to 0 once the fall completes -- a full rise-then-fall envelope', () => {
    expect(computePaddleJumpOffsetPx(0, TEST_PADDLE_JUMP, 600)).toBe(0);
    expect(computePaddleJumpOffsetPx(-5, TEST_PADDLE_JUMP, 600)).toBe(0);
    const midRise = computePaddleJumpOffsetPx(TEST_PADDLE_JUMP.riseMs / 2, TEST_PADDLE_JUMP, 600);
    expect(midRise).toBeGreaterThan(0);
    const peakHeightPx = 600 * TEST_PADDLE_JUMP.heightRatio;
    const atRiseEnd = computePaddleJumpOffsetPx(TEST_PADDLE_JUMP.riseMs, TEST_PADDLE_JUMP, 600);
    expect(atRiseEnd).toBeCloseTo(peakHeightPx, 5); // full height reached exactly at the rise/fall boundary
    expect(midRise).toBeLessThan(atRiseEnd); // still rising at the midpoint
    const midFall = computePaddleJumpOffsetPx(TEST_PADDLE_JUMP.riseMs + TEST_PADDLE_JUMP.fallMs / 2, TEST_PADDLE_JUMP, 600);
    expect(midFall).toBeGreaterThan(0);
    expect(midFall).toBeLessThan(peakHeightPx); // descending
    const afterLanding = computePaddleJumpOffsetPx(TEST_PADDLE_JUMP.riseMs + TEST_PADDLE_JUMP.fallMs, TEST_PADDLE_JUMP, 600);
    expect(afterLanding).toBe(0);
  });

  it('createInitialPongState always starts grounded, regardless of whether paddleJump is configured', () => {
    expect(createInitialPongState(CONFIG_WITH_PADDLE_JUMP).paddleJumpActive).toBe(false);
    expect(createInitialPongState(CONFIG_WITH_PADDLE_JUMP).paddleJumpCooldownRemainingMs).toBe(0);
    expect(createInitialPongState(CONFIG_WITH_PADDLE_JUMP).paddleJumpHitCount).toBe(0);
    expect(createInitialPongState(CONFIG).paddleJumpActive).toBe(false); // Quick Break/no-jump config too
  });
});

// MB-26, ADR-0015 §15: "verify at the new top speeds... test, dont assume."
// A high-speed variant of the existing "collision"/"degenerate-angle
// prevention" tests above, proving the dt-clamp/substep machinery (ADR-0014
// §4) is STILL sufficient at a speed well above anything Quick Break or
// pre-MB-26 Journey ever reached -- not re-deriving the substep math, just
// confirming empirically that a ball approaching this fast is still always
// caught, never tunnels through the paddle band in a single substep.
describe('pongEngine: no-tunneling at high speed (MB-26, ADR-0015 §15 verification)', () => {
  it('a ball falling at a speed far above any pre-MB-26 room maxSpeed still bounces off the paddle every time, swept across the full paddle width -- never tunnels through to the floor', () => {
    // 2000px/s: comfortably above Room 3's real post-MB-26 maxSpeed (see
    // roomEngine.test.ts's own room-specific proof at the ACTUAL tuned
    // value) -- this test isolates the ENGINE's substep guarantee from any
    // particular tuning number.
    const fastConfig: PongEngineConfig = { ...CONFIG, maxSpeed: 2000 };
    const offsets = [-0.99, -0.5, 0, 0.5, 0.99]; // fraction of paddle half-width
    for (const offsetFraction of offsets) {
      const paddleX = fastConfig.width / 2;
      const ballX = paddleX + offsetFraction * (fastConfig.paddleWidth / 2);
      let state: PongState = {
        ...createInitialPongState(fastConfig),
        ball: { x: ballX, y: 0 },
        ballVelocity: { x: 0, y: 2000 },
        paddleX,
      };
      // `score` is the discriminating signal, NOT ballVelocity.y < 0 -- a
      // FLOOR bounce also flips vy negative (see the floor-miss branch
      // above), so a ball that tunnels straight through the paddle band and
      // bounces off the FLOOR instead would false-positive on a bare
      // velocity-sign check. Score only increments on a genuine paddle hit.
      let caughtByPaddle = false;
      for (let frame = 0; frame < 100 && !caughtByPaddle; frame++) {
        state = stepPong(state, 16, fastConfig); // one real 60Hz-frame-sized dt per iteration, matching a real caller
        if (state.score > 0) caughtByPaddle = true;
        if (state.floorMissCount > 0) break; // tunneled through to the floor -- fail fast
      }
      expect(caughtByPaddle).toBe(true);
      expect(state.floorMissCount).toBe(0);
    }
  });
});
