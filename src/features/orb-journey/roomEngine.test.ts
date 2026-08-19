import { describe, expect, it } from 'vitest';
import { createInitialPongState, DEFAULT_PONG_CONFIG, type PongEngineConfig } from '../micro-breaks/engine/pongEngine';
import {
  buildRoomConfig,
  buildRoomSequence,
  createInitialJourneyState,
  deriveRoomEngineConfig,
  stepJourney,
  type JourneyState,
  type RoomConfig,
} from './roomEngine';

// Deterministic board config: no per-hit ramp noise for tests that don't need it.
const BOARD_CONFIG: PongEngineConfig = { ...DEFAULT_PONG_CONFIG, speedRampPerHit: 1 };

function hitState(journey: JourneyState, room: RoomConfig): JourneyState {
  return {
    ...journey,
    pong: { ...journey.pong, ball: { x: journey.pong.paddleX, y: room.engineConfig.paddleY - 10 }, ballVelocity: { x: 0, y: 300 } },
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

describe('roomEngine: buildRoomSequence (ADR-0015 §7, exactly 2 rooms)', () => {
  it('produces exactly 2 rooms, both the focus-tasks theme family', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms).toHaveLength(2);
    expect(rooms[0].theme).toBe('focus-tasks');
    expect(rooms[1].theme).toBe('focus-tasks');
  });

  it('room 2 has a higher combo goal than room 1 (room-index-only difficulty)', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    expect(rooms[1].goalCombo).toBeGreaterThan(rooms[0].goalCombo);
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

  it('clearing the LAST configured room sets phase to "cleared" without advancing past it (no room 3 authored this slice)', () => {
    const rooms = buildRoomSequence(BOARD_CONFIG);
    let journey: JourneyState = { roomIndex: 2, pong: createInitialPongState(rooms[1].engineConfig), journeyScore: 100, phase: 'playing' };

    for (let hit = 0; hit < rooms[1].goalCombo; hit++) {
      journey = hitState(journey, rooms[1]);
      journey = stepJourney(journey, 16, rooms);
    }

    expect(journey.roomIndex).toBe(2);
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
