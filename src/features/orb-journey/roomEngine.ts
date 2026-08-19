// ADR-0015 §1/§2/§3/§4: Orb Journey's room state machine. Pure, no DOM --
// configures the EXISTING pongEngine.ts physics engine per room (different
// speed/paddle-width params, different end condition), it does not fork or
// duplicate that engine's collision/angle/speed-cap logic. The only engine
// change this slice needed was pongEngine.ts's additive `floorMissCount`
// field, which this module consumes to detect "a miss just happened"
// unambiguously (see that field's own comment for why `combo` resetting to
// 0 alone is not a sufficient signal).
import { createInitialPongState, stepPong, type PongEngineConfig, type PongState } from '../micro-breaks/engine/pongEngine';
import {
  ROOM_1_GOAL_COMBO,
  ROOM_DIFFICULTY_PADDLE_SHRINK_STEP,
  ROOM_DIFFICULTY_SPEED_STEP,
  ROOM_GOAL_COMBO_STEP_PER_ROOM,
  ROOM_MIN_PADDLE_WIDTH_RATIO,
} from './tuning';

// ADR-0015 §7: exactly one theme family ships this slice.
export type RoomThemeId = 'focus-tasks';

export interface RoomConfig {
  readonly roomIndex: number; // 1-based
  readonly theme: RoomThemeId;
  readonly goalCombo: number;
  readonly engineConfig: PongEngineConfig;
}

// ADR-0015 §4: base difficulty scales with room index ONLY -- adaptive
// correction from recent performance is explicitly deferred (do not
// implement it here). Every OTHER engine field (durationSeconds, combo cap,
// final-wave fields) passes through from `base` untouched -- Journey never
// uses durationSeconds as an end condition (see stepJourney), so it's inert
// for this session type, kept only because PongEngineConfig requires it.
export function deriveRoomEngineConfig(roomIndex: number, base: PongEngineConfig): PongEngineConfig {
  const stepsBeyondFirst = Math.max(0, roomIndex - 1);
  const speedMultiplier = 1 + stepsBeyondFirst * ROOM_DIFFICULTY_SPEED_STEP;
  const paddleShrinkMultiplier = Math.max(
    ROOM_MIN_PADDLE_WIDTH_RATIO,
    1 - stepsBeyondFirst * ROOM_DIFFICULTY_PADDLE_SHRINK_STEP,
  );

  return {
    ...base,
    baseSpeed: base.baseSpeed * speedMultiplier,
    maxSpeed: base.maxSpeed * speedMultiplier,
    paddleWidth: base.paddleWidth * paddleShrinkMultiplier,
  };
}

export function buildRoomConfig(roomIndex: number, theme: RoomThemeId, boardConfig: PongEngineConfig): RoomConfig {
  return {
    roomIndex,
    theme,
    goalCombo: ROOM_1_GOAL_COMBO + (roomIndex - 1) * ROOM_GOAL_COMBO_STEP_PER_ROOM,
    engineConfig: deriveRoomEngineConfig(roomIndex, boardConfig),
  };
}

// ADR-0015 §7: exactly 2 rooms this slice, same theme family. Room 2 is a
// harder variant via room-index difficulty ONLY -- no new mechanic, no
// second theme.
export function buildRoomSequence(boardConfig: PongEngineConfig): readonly RoomConfig[] {
  return [buildRoomConfig(1, 'focus-tasks', boardConfig), buildRoomConfig(2, 'focus-tasks', boardConfig)];
}

// 'cleared': the LAST configured room's goal was reached. ADR-0015 §1/§3:
// Journey has no "game over" except explicit Esc/close, and this slice ships
// exactly 2 rooms (no room 3 to author) -- rather than inventing further
// content or looping the sequence (out of scope either way), clearing the
// final room simply stops advancing: the room's own physics keep running
// (the ball keeps playing, still scorable) and the HUD acknowledges
// completion instead of transitioning again. See this module's own report
// section for this judgment call.
export type JourneyPhase = 'playing' | 'cleared';

export interface JourneyState {
  readonly roomIndex: number; // 1-based, index into the room sequence
  readonly pong: PongState;
  /** ADR-0015 §9: cumulative across the WHOLE journey session, never reset
   *  by a room-local restart (only room progress is room-local -- score is
   *  not, per §3's rationale: "failure only costs room-local time, not
   *  global progress"). Lives only in memory, lost on close (no
   *  persistence this slice). */
  readonly journeyScore: number;
  readonly phase: JourneyPhase;
}

export function createInitialJourneyState(rooms: readonly RoomConfig[]): JourneyState {
  return {
    roomIndex: 1,
    pong: createInitialPongState(rooms[0].engineConfig),
    journeyScore: 0,
    phase: 'playing',
  };
}

function getRoom(journey: JourneyState, rooms: readonly RoomConfig[]): RoomConfig {
  const room = rooms[journey.roomIndex - 1];
  if (!room) throw new Error(`Orb Journey: no room configured for index ${journey.roomIndex}`);
  return room;
}

// ADR-0015 §3: a miss (floor contact) restarts the CURRENT room only --
// never the whole Journey, never a life system. §9: journeyScore is
// untouched by a restart; only the room-local physics state resets.
// ADR-0015 §2: a room-complete transition swaps to the NEXT room's engine
// config (or, on the final configured room, enters 'cleared' -- see
// JourneyPhase's own comment) with no hard reload -- the caller (a Journey-
// aware canvas) is expected to render a short, reduced-motion-aware
// transition around this state change, not this pure function's concern.
export function stepJourney(journey: JourneyState, dtMs: number, rooms: readonly RoomConfig[]): JourneyState {
  const currentRoom = getRoom(journey, rooms);
  const stepped = stepPong(journey.pong, dtMs, currentRoom.engineConfig);

  // Score accumulates from the engine's own combo-formula delta for this
  // step -- reused, not recomputed, so Journey never duplicates Quick
  // Break's scoring rule (ADR-0015 Consequences: "no physics duplication").
  const journeyScore = journey.journeyScore + (stepped.score - journey.pong.score);

  const missedThisStep = stepped.floorMissCount > journey.pong.floorMissCount;
  if (missedThisStep) {
    return {
      ...journey,
      pong: createInitialPongState(currentRoom.engineConfig),
      journeyScore,
    };
  }

  const roomCleared = journey.phase === 'playing' && stepped.combo >= currentRoom.goalCombo;
  if (roomCleared) {
    const isLastRoom = journey.roomIndex >= rooms.length;
    if (isLastRoom) {
      return { ...journey, pong: stepped, journeyScore, phase: 'cleared' };
    }
    const nextRoomIndex = journey.roomIndex + 1;
    const nextRoom = getRoom({ ...journey, roomIndex: nextRoomIndex }, rooms);
    return {
      roomIndex: nextRoomIndex,
      pong: createInitialPongState(nextRoom.engineConfig),
      journeyScore,
      phase: 'playing',
    };
  }

  return { ...journey, pong: stepped, journeyScore };
}
