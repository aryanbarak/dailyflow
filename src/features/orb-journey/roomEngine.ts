// ADR-0015 §1/§2/§3/§4: Orb Journey's room state machine. Pure, no DOM --
// configures the EXISTING pongEngine.ts physics engine per room (different
// speed/paddle-width params, different end condition), it does not fork or
// duplicate that engine's collision/angle/speed-cap logic. The only engine
// change this slice needed was pongEngine.ts's additive `floorMissCount`
// field, which this module consumes to detect "a miss just happened"
// unambiguously (see that field's own comment for why `combo` resetting to
// 0 alone is not a sufficient signal).
import {
  createInitialPongState,
  stepPong,
  type PongDriftingOrbConfig,
  type PongEngineConfig,
  type PongObstacleConfig,
  type PongState,
} from '../micro-breaks/engine/pongEngine';
import {
  DRIFTING_ORB_DRIFT_SPEED_PX_PER_SECOND,
  DRIFTING_ORB_PENALTY_SPEED_MULTIPLIER,
  DRIFTING_ORB_RADIUS_RATIO,
  DRIFTING_ORB_REWARD_SPEED_MULTIPLIER,
  DRIFTING_ORB_SPAWN_INTERVAL_MS,
  DRIFTING_ORB_SPEED_MULTIPLIER_DURATION_SECONDS,
  OBSTACLE_COMBO_THRESHOLD_TO_BREAK,
  OBSTACLE_HEIGHT_RATIO,
  OBSTACLE_WIDTH_RATIO,
  OBSTACLE_Y_RATIO,
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
  /** MB-07, ADR-0015 §10 (amendment): empty for Room 1 by design (§7's
   *  "intro, forgiving" framing, PO-confirmed) -- this slice ships exactly
   *  one breakable obstacle, in Room 2 only. The SAME array reference is
   *  also set on `engineConfig.obstacles` (see buildRoomConfig) so there is
   *  exactly one source of truth for obstacle geometry, not two that could
   *  drift apart. */
  readonly obstacles: readonly PongObstacleConfig[];
  /** MB-08, ADR-0015 §11 (amendment): undefined for Room 1 by design (§7's
   *  "intro, forgiving" framing) -- this slice's drifting-orb spawning
   *  ships in Room 2 only, additive alongside §10's static obstacle. The
   *  SAME object reference is also set on `engineConfig.driftingOrbSpawn`
   *  (see buildRoomConfig), one source of truth like `obstacles` above. */
  readonly driftingOrbSpawn: PongDriftingOrbConfig | undefined;
  readonly engineConfig: PongEngineConfig;
}

// MB-07, ADR-0015 §10 (amendment): Room 2's single breakable obstacle.
// Positioned well clear of the decorative Focus/Tasks background cards
// (roomTheme.ts's drawFocusTasksTheme occupies roughly the top half of the
// board) and well above the paddle band, so it reads as a distinct,
// physical mid-board hazard rather than part of the background. Geometry is
// derived from the room's OWN engineConfig dimensions (post-resize-safe --
// this is called fresh every time buildRoomConfig runs, including on a
// board resize), never a fixed pixel size.
//
// FUTURE TIE-IN (not implemented here, out of this slice's scope per the
// task brief): a constellation/meta-progression layer could eventually
// track "obstacles broken across a Journey session" as a new signal --
// this function is the natural place such a system would read obstacle
// IDs/positions from, but nothing here calls out to it.
export function buildRoomObstacles(roomIndex: number, engineConfig: PongEngineConfig): readonly PongObstacleConfig[] {
  if (roomIndex !== 2) return []; // Room 1 stays obstacle-free by design (ADR-0015 §7/§10)

  const width = engineConfig.width * OBSTACLE_WIDTH_RATIO;
  const height = engineConfig.height * OBSTACLE_HEIGHT_RATIO;
  return [
    {
      id: 'room-2-obstacle-1',
      x: (engineConfig.width - width) / 2,
      y: engineConfig.height * OBSTACLE_Y_RATIO,
      width,
      height,
      breakable: true,
      comboThresholdToBreak: OBSTACLE_COMBO_THRESHOLD_TO_BREAK,
    },
  ];
}

// MB-08, ADR-0015 §11 (amendment): Room 2's drifting-orb spawn recipe.
// Radius scales with the room's own engineConfig.width (post-resize-safe,
// like buildRoomObstacles above); drift speed is a flat px/s value, NOT
// rescaled by board size -- matching this codebase's existing precedent for
// baseSpeed/maxSpeed (computeBoardConfig only rescales DIMENSIONAL fields,
// see that function's own comment), not a new inconsistency introduced here.
export function buildDriftingOrbSpawnConfig(roomIndex: number, engineConfig: PongEngineConfig): PongDriftingOrbConfig | undefined {
  if (roomIndex !== 2) return undefined; // Room 1 stays free of drifting orbs by design (ADR-0015 §7/§11)

  return {
    spawnIntervalMs: DRIFTING_ORB_SPAWN_INTERVAL_MS,
    driftSpeedPxPerSecond: DRIFTING_ORB_DRIFT_SPEED_PX_PER_SECOND,
    radius: engineConfig.width * DRIFTING_ORB_RADIUS_RATIO,
    rewardSpeedMultiplier: DRIFTING_ORB_REWARD_SPEED_MULTIPLIER,
    penaltySpeedMultiplier: DRIFTING_ORB_PENALTY_SPEED_MULTIPLIER,
    speedMultiplierDurationSeconds: DRIFTING_ORB_SPEED_MULTIPLIER_DURATION_SECONDS,
  };
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
  const engineConfig = deriveRoomEngineConfig(roomIndex, boardConfig);
  const obstacles = buildRoomObstacles(roomIndex, engineConfig);
  const driftingOrbSpawn = buildDriftingOrbSpawnConfig(roomIndex, engineConfig);
  return {
    roomIndex,
    theme,
    goalCombo: ROOM_1_GOAL_COMBO + (roomIndex - 1) * ROOM_GOAL_COMBO_STEP_PER_ROOM,
    obstacles,
    driftingOrbSpawn,
    engineConfig: { ...engineConfig, obstacles, driftingOrbSpawn },
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
export function stepJourney(
  journey: JourneyState,
  dtMs: number,
  rooms: readonly RoomConfig[],
  random: () => number = Math.random,
): JourneyState {
  const currentRoom = getRoom(journey, rooms);
  const stepped = stepPong(journey.pong, dtMs, currentRoom.engineConfig, random);

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
