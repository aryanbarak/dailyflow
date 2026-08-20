import { describe, expect, it } from 'vitest';
import {
  createInitialPongState,
  DEFAULT_PONG_CONFIG,
  stepPong,
  type PongEngineConfig,
  type PongObstacleConfig,
  type PongState,
} from '../micro-breaks/engine/pongEngine';
import {
  buildRoomConfig,
  buildRoomSequence,
  createInitialJourneyState,
  deriveRoomEngineConfig,
  stepJourney,
  type JourneyState,
  type RoomConfig,
} from './roomEngine';

// MB-06: the pre-MB-06 (MB-05-shipped) difficulty step, kept here ONLY as a
// historical floor for the "noticeably wider than before" proof below -- NOT
// re-imported from tuning.ts, since the whole point is to catch a future
// accidental narrowing back towards (or below) what PO manual QA on MB-05
// already reported as "hardly felt different."
const MB05_SPEED_STEP = 0.08;
const MB05_PADDLE_SHRINK_STEP = 0.04;

// Deterministic board config: no per-hit ramp noise for tests that don't need it.
const BOARD_CONFIG: PongEngineConfig = { ...DEFAULT_PONG_CONFIG, speedRampPerHit: 1 };

function hitState(journey: JourneyState, room: RoomConfig): JourneyState {
  return {
    ...journey,
    pong: { ...journey.pong, ball: { x: journey.pong.paddleX, y: room.engineConfig.paddleY - 10 }, ballVelocity: { x: 0, y: 300 } },
  };
}

// MB-07, ADR-0015 §10 (amendment): positions the ball to descend into the
// room's first obstacle's top face on the next step. Caller is responsible
// for combo already being at/above the threshold if a break is expected.
function obstacleHitState(journey: JourneyState, room: RoomConfig): JourneyState {
  const obstacle = room.obstacles[0];
  const r = room.engineConfig.ballRadius;
  return {
    ...journey,
    pong: { ...journey.pong, ball: { x: obstacle.x + obstacle.width / 2, y: obstacle.y - r }, ballVelocity: { x: 0, y: 300 } },
  };
}

function missState(journey: JourneyState, room: RoomConfig): JourneyState {
  return {
    ...journey,
    pong: { ...journey.pong, ball: { x: 10, y: room.engineConfig.height - 2 }, paddleX: room.engineConfig.width - 5, ballVelocity: { x: 0, y: 300 } },
  };
}

describe('roomEngine: deriveRoomEngineConfig (ADR-0015 §4, room-index-only difficulty)', () => {
  it('room 1 is unchanged from the base config (no difficulty step applied yet)', () => {
    const config = deriveRoomEngineConfig(1, BOARD_CONFIG);
    expect(config.baseSpeed).toBe(BOARD_CONFIG.baseSpeed);
    expect(config.paddleWidth).toBe(BOARD_CONFIG.paddleWidth);
  });

  it('a later room index is harder: faster base speed, narrower paddle than an earlier room', () => {
    const room1 = deriveRoomEngineConfig(1, BOARD_CONFIG);
    const room2 = deriveRoomEngineConfig(2, BOARD_CONFIG);
    const room6 = deriveRoomEngineConfig(6, BOARD_CONFIG);

    expect(room2.baseSpeed).toBeGreaterThan(room1.baseSpeed);
    expect(room2.paddleWidth).toBeLessThan(room1.paddleWidth);
    expect(room6.baseSpeed).toBeGreaterThan(room2.baseSpeed); // "room 6 is harder than room 1" -- ADR-0015 §4
  });

  it('leaves every non-difficulty field (combo cap, final-wave fields) untouched -- only speed/paddle change', () => {
    const config = deriveRoomEngineConfig(3, BOARD_CONFIG);
    expect(config.comboCap).toBe(BOARD_CONFIG.comboCap);
    expect(config.finalWaveWindowSeconds).toBe(BOARD_CONFIG.finalWaveWindowSeconds);
  });
});

describe('roomEngine: MB-06 widened room-2 difficulty step (PO QA: "hardly felt different" on MB-05)', () => {
  it('room 2s speed step is noticeably larger than the MB-05-shipped step, not just nonzero', () => {
    const room1 = deriveRoomEngineConfig(1, BOARD_CONFIG);
    const room2 = deriveRoomEngineConfig(2, BOARD_CONFIG);
    const actualSpeedStep = room2.baseSpeed / room1.baseSpeed - 1;
    // A 1.5x margin over the old step (not a bare `> MB05_SPEED_STEP`) so
    // this can't pass on floating-point rounding noise alone -- a prior
    // draft of this test used a bare comparison and the paddle-shrink
    // equivalent passed against the OLD 0.04 constant purely from a
    // division rounding artifact, proving nothing.
    expect(actualSpeedStep).toBeGreaterThan(MB05_SPEED_STEP * 1.5);
    // Sanity band: "noticeably harder" is not "punishingly harder" -- keep
    // this a room-to-room step, not a multi-hundred-percent jump.
    expect(actualSpeedStep).toBeLessThan(0.5);
  });

  it('room 2s paddle-shrink step is noticeably larger than the MB-05-shipped step, not just nonzero', () => {
    const room1 = deriveRoomEngineConfig(1, BOARD_CONFIG);
    const room2 = deriveRoomEngineConfig(2, BOARD_CONFIG);
    const actualShrinkStep = 1 - room2.paddleWidth / room1.paddleWidth;
    expect(actualShrinkStep).toBeGreaterThan(MB05_PADDLE_SHRINK_STEP * 1.5); // margin, see the speed-step test's own comment
    expect(actualShrinkStep).toBeLessThan(0.3); // still legitimately playable, per ROOM_MIN_PADDLE_WIDTH_RATIO's own intent
  });

  it('maxSpeed scales WITH baseSpeed (the room-local ceiling moves together with the floor, never leaving baseSpeed able to exceed maxSpeed)', () => {
    const room2 = deriveRoomEngineConfig(2, BOARD_CONFIG);
    expect(room2.baseSpeed).toBeLessThanOrEqual(room2.maxSpeed);
  });
});

describe('roomEngine: difficulty tuning respects the ADR-0014 §4 hard ceilings (speed cap, degenerate-angle guard)', () => {
  it('degenerate-angle guard (maxBounceAngleRad) is passed through UNCHANGED by room difficulty scaling, for every room', () => {
    for (const roomIndex of [1, 2, 6]) {
      const config = deriveRoomEngineConfig(roomIndex, BOARD_CONFIG);
      expect(config.maxBounceAngleRad).toBe(BOARD_CONFIG.maxBounceAngleRad);
      expect(config.maxBounceAngleRad).toBeLessThan(Math.PI / 2); // ADR-0014 §4: must stay strictly below 90 degrees
    }
  });

  it('even under room 2s widened speed step, repeated paddle hits never push ball speed past that rooms own maxSpeed', () => {
    const rooms = buildRoomSequence({ ...DEFAULT_PONG_CONFIG, speedRampPerHit: 1.045 }); // real per-hit ramp, not the deterministic test override
    const room2 = rooms[1];
    let state: PongState = createInitialPongState(room2.engineConfig);

    for (let hit = 0; hit < 60; hit++) {
      state = { ...state, ball: { x: state.paddleX, y: room2.engineConfig.paddleY - 2 }, ballVelocity: { x: 0, y: 300 } };
      state = stepPong(state, 16, room2.engineConfig);
      const speed = Math.hypot(state.ballVelocity.x, state.ballVelocity.y);
      expect(speed).toBeLessThanOrEqual(room2.engineConfig.maxSpeed + 1e-6);
    }
  });
});

describe('roomEngine: buildRoomSequence (ADR-0015 §7/§12, 3 rooms as of MB-13)', () => {
  it('produces exactly 3 rooms: focus-tasks, focus-tasks, rhythm-calendar', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms).toHaveLength(3);
    expect(rooms[0].theme).toBe('focus-tasks');
    expect(rooms[1].theme).toBe('focus-tasks');
    expect(rooms[2].theme).toBe('rhythm-calendar');
  });

  it('room 2 has a higher combo goal than room 1, and room 3 higher still (room-index-only difficulty)', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms[1].goalCombo).toBeGreaterThan(rooms[0].goalCombo);
    expect(rooms[2].goalCombo).toBeGreaterThan(rooms[1].goalCombo);
  });

  // MB-13, ADR-0015 §12: Rooms 1 and 2 must come out of buildRoomSequence
  // byte-for-byte identical to before this slice -- a regression guard
  // against Room 3's addition accidentally perturbing the existing rooms
  // (e.g. via a shared-array or off-by-one mistake in the new 3rd entry).
  it('Rooms 1 and 2 are BYTE-FOR-BYTE unchanged by Room 3s addition', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    const room1Alone = buildRoomConfig(1, 'focus-tasks', BOARD_CONFIG);
    const room2Alone = buildRoomConfig(2, 'focus-tasks', BOARD_CONFIG);
    expect(rooms[0]).toEqual(room1Alone);
    expect(rooms[1]).toEqual(room2Alone);
  });

  // MB-13, ADR-0015 §12: Room 3's one content lever -- a faster
  // drifting-orb spawn cadence than Room 2's, same everything else.
  it('Room 3 has a drifting-orb spawn config with a SHORTER interval than Room 2s, everything else identical', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    const room2Spawn = rooms[1].driftingOrbSpawn;
    const room3Spawn = rooms[2].driftingOrbSpawn;
    expect(room2Spawn).toBeDefined();
    expect(room3Spawn).toBeDefined();
    expect(room3Spawn!.spawnIntervalMs).toBeLessThan(room2Spawn!.spawnIntervalMs);
    expect(room3Spawn!.driftSpeedPxPerSecond).toBe(room2Spawn!.driftSpeedPxPerSecond);
    expect(room3Spawn!.rewardSpeedStep).toBe(room2Spawn!.rewardSpeedStep);
    expect(room3Spawn!.penaltySpeedStep).toBe(room2Spawn!.penaltySpeedStep);
  });

  it('Room 3 authors zero static obstacles, consistent with §10s retirement note', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms[2].obstacles).toEqual([]);
    expect(rooms[2].engineConfig.obstacles).toEqual([]);
  });

  // MB-13, ADR-0015 §4/§12: room-index-only difficulty must keep scaling
  // through Room 3 -- confirms deriveRoomEngineConfig's existing formula
  // naturally produces a harder-than-Room-2 result (no hand-tuned new
  // constant needed for Room 3s difficulty).
  it('Room 3 is measurably harder than Room 2: faster base speed, narrower paddle, both still within the existing hard bounds', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    const room2 = rooms[1].engineConfig;
    const room3 = rooms[2].engineConfig;
    expect(room3.baseSpeed).toBeGreaterThan(room2.baseSpeed);
    expect(room3.paddleWidth).toBeLessThan(room2.paddleWidth);
    expect(room3.baseSpeed).toBeLessThanOrEqual(room3.maxSpeed);
    expect(room3.paddleWidth).toBeGreaterThanOrEqual(BOARD_CONFIG.paddleWidth * 0.55); // ROOM_MIN_PADDLE_WIDTH_RATIO floor, not clipped to it
  });
});

describe('roomEngine: stepJourney -- room complete transitions to the next room config', () => {
  it('reaching room 1s goal combo advances to room 2, resetting room-local ball/combo but keeping journeyScore', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    let journey = createInitialJourneyState(rooms);

    for (let hit = 0; hit < rooms[0].goalCombo - 1; hit++) {
      journey = hitState(journey, rooms[0]);
      journey = stepJourney(journey, 16, rooms);
    }
    expect(journey.roomIndex).toBe(1);
    expect(journey.pong.combo).toBe(rooms[0].goalCombo - 1);

    // The final hit that clears room 1's goal.
    journey = hitState(journey, rooms[0]);
    journey = stepJourney(journey, 16, rooms);

    expect(journey.roomIndex).toBe(2);
    expect(journey.phase).toBe('playing');
    expect(journey.pong.combo).toBe(0); // fresh room state
    expect(journey.journeyScore).toBeGreaterThan(0); // NOT reset by the room transition
  });

  // MB-13, ADR-0015 §12 boundary test: clearing Room 2 (no longer the last
  // configured room) must advance to Room 3, 'playing' -- NOT enter
  // 'cleared'. Explicit, not assumed -- this is exactly the boundary
  // condition that changed when Room 3 was added.
  it('clearing room 2 now advances to room 3, "playing" -- room 2 is no longer the last configured room', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    let journey: JourneyState = { roomIndex: 2, pong: createInitialPongState(rooms[1].engineConfig), journeyScore: 100, phase: 'playing' };

    for (let hit = 0; hit < rooms[1].goalCombo; hit++) {
      journey = hitState(journey, rooms[1]);
      journey = stepJourney(journey, 16, rooms);
    }

    expect(journey.roomIndex).toBe(3);
    expect(journey.phase).toBe('playing');
    expect(journey.pong.combo).toBe(0); // fresh Room 3 state
  });

  it('clearing the LAST configured room (room 3, as of MB-13) sets phase to "cleared" without advancing past it', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    let journey: JourneyState = { roomIndex: 3, pong: createInitialPongState(rooms[2].engineConfig), journeyScore: 100, phase: 'playing' };

    for (let hit = 0; hit < rooms[2].goalCombo; hit++) {
      journey = hitState(journey, rooms[2]);
      journey = stepJourney(journey, 16, rooms);
    }

    expect(journey.roomIndex).toBe(3);
    expect(journey.phase).toBe('cleared');
  });
});

describe('roomEngine: stepJourney -- a miss restarts the CURRENT room only (ADR-0015 §3)', () => {
  it('a floor miss resets the room-local ball/combo to a fresh room-start state, WITHOUT touching roomIndex or journeyScore', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    let journey = createInitialJourneyState(rooms);

    // Build up some combo/score first.
    for (let hit = 0; hit < 3; hit++) {
      journey = hitState(journey, rooms[0]);
      journey = stepJourney(journey, 16, rooms);
    }
    expect(journey.pong.combo).toBe(3);
    const scoreBeforeMiss = journey.journeyScore;
    const roomIndexBeforeMiss = journey.roomIndex;

    journey = missState(journey, rooms[0]);
    journey = stepJourney(journey, 16, rooms);

    expect(journey.roomIndex).toBe(roomIndexBeforeMiss); // still the SAME room, not the whole journey restarting
    expect(journey.journeyScore).toBe(scoreBeforeMiss); // global progress untouched -- ADR-0015 §3's whole rationale
    expect(journey.pong.combo).toBe(0);
    // Room-local ball position reset to the room's own fresh start (center X).
    expect(journey.pong.ball.x).toBeCloseTo(rooms[0].engineConfig.width / 2, 5);
  });

  it('a miss BEFORE any hit this room (combo already 0) still restarts the room -- the floorMissCount signal, not combo, is what detects this', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    let journey = createInitialJourneyState(rooms);
    expect(journey.pong.combo).toBe(0); // nothing has happened yet

    journey = missState(journey, rooms[0]);
    // Proves the miss-state setup actually moved the ball off-center --
    // otherwise the next assertion (ball back at center after stepping)
    // would trivially pass even if stepJourney did nothing at all.
    expect(journey.pong.ball.x).toBeCloseTo(10, 5);

    const stepped = stepJourney(journey, 16, rooms);

    expect(stepped.pong.ball.x).toBeCloseTo(rooms[0].engineConfig.width / 2, 5);
    expect(stepped.roomIndex).toBe(1);
  });

  it('a miss while phase is "cleared" still resets that room, without leaving "cleared" or touching journeyScore', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    let journey: JourneyState = { roomIndex: 2, pong: { ...createInitialPongState(rooms[1].engineConfig), combo: 5 }, journeyScore: 250, phase: 'cleared' };

    journey = missState(journey, rooms[1]);
    journey = stepJourney(journey, 16, rooms);

    expect(journey.phase).toBe('cleared');
    expect(journey.journeyScore).toBe(250);
    expect(journey.pong.combo).toBe(0);
  });

  // MB-09, ADR-0015 §10 (retirement note): Room 2 no longer authors a
  // breakable obstacle (see the "breakable obstacles" describe block below),
  // so this proof can no longer drive itself off buildRoomSequence's real
  // output. The room-restart RESET MECHANISM itself is explicitly kept as
  // generic, additive infrastructure for a future room -- so it's still
  // worth proving that mechanism works, via a hand-built RoomConfig with a
  // synthetic obstacle (mirrors pongEngine.test.ts's own CONFIG_WITH_OBSTACLE
  // pattern), rather than deleting this coverage outright.
  it('room-restart correctness: breaking a room-authored obstacle, then missing, resets the obstacle to intact -- the SAME room-local restart path, no separate reset code (proven via a synthetic obstacle since no shipped room authors one post-MB-09)', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    const room2 = rooms[1];
    const syntheticObstacle: PongObstacleConfig = { id: 'synthetic-1', x: 10, y: 10, width: 50, height: 10, breakable: true, comboThresholdToBreak: 2 };
    const roomWithObstacle: RoomConfig = {
      ...room2,
      obstacles: [syntheticObstacle],
      engineConfig: { ...room2.engineConfig, obstacles: [syntheticObstacle] },
    };
    const roomsWithObstacle = [rooms[0], roomWithObstacle];

    let journey: JourneyState = { roomIndex: 2, pong: createInitialPongState(roomWithObstacle.engineConfig), journeyScore: 0, phase: 'playing' };

    // Build combo to the break threshold via paddle hits, then hit the obstacle.
    for (let hit = 0; hit < syntheticObstacle.comboThresholdToBreak!; hit++) {
      journey = hitState(journey, roomWithObstacle);
      journey = stepJourney(journey, 16, roomsWithObstacle);
    }
    journey = obstacleHitState(journey, roomWithObstacle);
    journey = stepJourney(journey, 16, roomsWithObstacle);
    expect(journey.pong.obstacles).toEqual([{ id: syntheticObstacle.id, broken: true }]); // confirms the break actually happened -- otherwise the reset assertion below would be trivially true

    // Now miss (room-local restart) -- still Room 2, same obstacle config,
    // but a FRESH pong state.
    journey = missState(journey, roomWithObstacle);
    journey = stepJourney(journey, 16, roomsWithObstacle);

    expect(journey.roomIndex).toBe(2); // still the same room, not the whole journey restarting
    expect(journey.pong.obstacles).toEqual([{ id: syntheticObstacle.id, broken: false }]);
  });
});

describe('roomEngine: drifting speed-orbs (MB-08, ADR-0015 §11 amendment)', () => {
  it('Room 1 has NO drifting-orb spawn config while Room 2 DOES -- regression guard against an accidental copy-paste into the intro room (ADR-0015 §7/§11)', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms[0].driftingOrbSpawn).toBeUndefined();
    expect(rooms[0].engineConfig.driftingOrbSpawn).toBeUndefined();
    // Contrasted against Room 2 in the SAME test -- an "absent" assertion
    // alone can't be disproven by full reversion (undefined === undefined
    // either way); pairing it with "Room 2 IS defined" means this test
    // actually depends on the real implementation existing.
    expect(rooms[1].driftingOrbSpawn).toBeDefined();
  });

  it('Room 2 has a sane drifting-orb spawn config: positive cadence/speed/radius; reward > 1 (speeds up) > penalty (slows down) -- MB-10s revised mapping', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    const spawnConfig = rooms[1].driftingOrbSpawn;
    expect(spawnConfig).toBeDefined();
    expect(spawnConfig!.spawnIntervalMs).toBeGreaterThan(0);
    expect(spawnConfig!.driftSpeedPxPerSecond).toBeGreaterThan(0);
    expect(spawnConfig!.radius).toBeGreaterThan(0);
    expect(spawnConfig!.rewardSpeedStep).toBeGreaterThan(1);
    expect(spawnConfig!.penaltySpeedStep).toBeLessThan(1);
    // MB-10: NOT assumed to be mathematical inverses -- independently PO-tunable.
    expect(spawnConfig!.rewardSpeedStep).not.toBeCloseTo(1 / spawnConfig!.penaltySpeedStep, 5);
  });

  it('RoomConfig.driftingOrbSpawn and engineConfig.driftingOrbSpawn are the SAME object reference -- one source of truth', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms[1].driftingOrbSpawn).toBeDefined(); // guards against this passing trivially on undefined === undefined
    expect(rooms[1].driftingOrbSpawn).toBe(rooms[1].engineConfig.driftingOrbSpawn);
  });

  it('room-restart correctness: ball speed resets to the ROOM BASE speed after a sequence of reward/penalty events, and any remaining active orbs clear too (the leak-prone case, MB-10 revision of MB-08s own test)', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    const room2 = rooms[1];
    const baseSpeed = Math.hypot(createInitialPongState(room2.engineConfig).ballVelocity.x, createInitialPongState(room2.engineConfig).ballVelocity.y);
    let journey: JourneyState = { roomIndex: 2, pong: createInitialPongState(room2.engineConfig), journeyScore: 0, phase: 'playing' };

    // Two reward catches in a row, positioned exactly at the ball each time
    // -- caught on the very next step (same pattern proven at the
    // pongEngine.ts level). MB-10: effects COMPOUND, so this leaves ball
    // speed well above the room's base speed going into the restart --
    // otherwise the reset assertion below would be trivially true (nothing
    // to reset FROM).
    for (let i = 0; i < 2; i++) {
      journey = {
        ...journey,
        pong: { ...journey.pong, driftingOrbs: [{ id: `reward-${i}`, x: journey.pong.ball.x, y: journey.pong.ball.y, role: 'reward' }] },
      };
      journey = stepJourney(journey, 16, rooms);
    }
    expect(journey.pong.driftingOrbs).toEqual([]); // both caught -- confirms the catches actually happened
    const speedBeforeRestart = Math.hypot(journey.pong.ballVelocity.x, journey.pong.ballVelocity.y);
    expect(speedBeforeRestart).toBeGreaterThan(baseSpeed * 1.5); // meaningfully elevated, not a rounding coincidence

    // Add a SECOND, still-uncaught orb too, to prove active orbs also clear on restart.
    journey = { ...journey, pong: { ...journey.pong, driftingOrbs: [{ id: 'still-active', x: 50, y: 50, role: 'reward' }] } };

    journey = missState(journey, room2);
    journey = stepJourney(journey, 16, rooms);

    expect(journey.roomIndex).toBe(2); // still the same room, not the whole journey restarting
    expect(journey.pong.driftingOrbs).toEqual([]);
    const speedAfterRestart = Math.hypot(journey.pong.ballVelocity.x, journey.pong.ballVelocity.y);
    expect(speedAfterRestart).toBeCloseTo(baseSpeed, 5); // reset to the room's own base speed, not just "lower than before"
  });

  // MB-13, ADR-0015 §12: the SAME leak-prone case as Room 2's own test
  // above, proven again for Room 3 explicitly (per the task brief -- "same
  // leak-prone class flagged in every prior slice," not assumed to transfer
  // automatically just because the code path is shared).
  it('Room 3 room-restart correctness: ball speed resets to Room 3s OWN base speed after reward/penalty events, and active orbs clear too', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    const room3 = rooms[2];
    const baseSpeed = Math.hypot(createInitialPongState(room3.engineConfig).ballVelocity.x, createInitialPongState(room3.engineConfig).ballVelocity.y);
    let journey: JourneyState = { roomIndex: 3, pong: createInitialPongState(room3.engineConfig), journeyScore: 0, phase: 'playing' };

    for (let i = 0; i < 2; i++) {
      journey = {
        ...journey,
        pong: { ...journey.pong, driftingOrbs: [{ id: `reward-${i}`, x: journey.pong.ball.x, y: journey.pong.ball.y, role: 'reward' }] },
      };
      journey = stepJourney(journey, 16, rooms);
    }
    expect(journey.pong.driftingOrbs).toEqual([]); // both caught -- confirms the catches actually happened
    const speedBeforeRestart = Math.hypot(journey.pong.ballVelocity.x, journey.pong.ballVelocity.y);
    expect(speedBeforeRestart).toBeGreaterThan(baseSpeed * 1.5); // meaningfully elevated, not a rounding coincidence

    journey = { ...journey, pong: { ...journey.pong, driftingOrbs: [{ id: 'still-active', x: 50, y: 50, role: 'reward' }] } };

    journey = missState(journey, room3);
    journey = stepJourney(journey, 16, rooms);

    expect(journey.roomIndex).toBe(3); // still the same room, not the whole journey restarting
    expect(journey.pong.driftingOrbs).toEqual([]);
    const speedAfterRestart = Math.hypot(journey.pong.ballVelocity.x, journey.pong.ballVelocity.y);
    expect(speedAfterRestart).toBeCloseTo(baseSpeed, 5); // reset to Room 3s OWN base speed (harder than Room 2s), not just "lower than before"
  });
});

describe('roomEngine: no overall "game over" other than explicit close', () => {
  it('an interleaved sequence of hits and misses across a room restart never produces any "ended"/"game over" status -- pong.status stays "playing" throughout', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    let journey = createInitialJourneyState(rooms);

    const actions: Array<'hit' | 'miss'> = ['hit', 'hit', 'miss', 'hit', 'miss', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit'];
    for (const action of actions) {
      const currentRoom = rooms[journey.roomIndex - 1];
      journey = action === 'hit' ? hitState(journey, currentRoom) : missState(journey, currentRoom);
      journey = stepJourney(journey, 16, rooms);
      expect(journey.pong.status).toBe('playing');
    }
  });
});

describe('roomEngine: buildRoomConfig', () => {
  it('goalCombo increases by the configured step per room index beyond 1', () => {
    const room1 = buildRoomConfig(1, 'focus-tasks', BOARD_CONFIG);
    const room2 = buildRoomConfig(2, 'focus-tasks', BOARD_CONFIG);
    const room3 = buildRoomConfig(3, 'focus-tasks', BOARD_CONFIG);
    const step2 = room2.goalCombo - room1.goalCombo;
    const step3 = room3.goalCombo - room2.goalCombo;
    expect(step2).toBeGreaterThan(0);
    expect(step3).toBe(step2); // linear step, per ADR-0015 §4's room-index-ONLY rule
  });
});

describe('roomEngine: breakable obstacles (MB-07, ADR-0015 §10 amendment; retired for Room 2 by MB-09, ADR-0015 §10 retirement note)', () => {
  // MB-09: Room 1 and Room 2 are now symmetric on `obstacles` -- both empty.
  // Combined into ONE test with a contrasting pair of assertions (same fix
  // already applied in MB-08's own report for an analogous "both sides
  // undefined" risk) rather than two separate tests: a lone
  // `toEqual([])` per room is NOT trivial on its own here (a full revert of
  // roomEngine.ts would put a real obstacle back into Room 2's array, so the
  // assertion genuinely depends on the real change), but keeping both rooms'
  // checks in one test still directly documents the new symmetry as a single
  // fact, matching the drifting-orb block's "Room 1 has NO ... while Room 2
  // DOES" contrast pattern one test up.
  it('Room 1 AND Room 2 both author ZERO obstacles now -- symmetric (ADR-0015 §10 retirement note; §7 Room 1 was already obstacle-free by design)', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms[0].obstacles).toEqual([]);
    expect(rooms[0].engineConfig.obstacles).toEqual([]);
    expect(rooms[1].obstacles).toEqual([]);
    expect(rooms[1].engineConfig.obstacles).toEqual([]);
  });

  it('RoomConfig.obstacles and engineConfig.obstacles are the SAME array reference even though both are now empty -- one source of truth, no drift risk', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms[1].obstacles).toBe(rooms[1].engineConfig.obstacles);
    expect(rooms[0].obstacles).toBe(rooms[0].engineConfig.obstacles);
  });
});
