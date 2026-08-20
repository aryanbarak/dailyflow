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
  DRIFTING_ORB_PENALTY_SPEED_STEP,
  DRIFTING_ORB_RADIUS_RATIO,
  DRIFTING_ORB_REWARD_SPEED_STEP,
  DRIFTING_ORB_SPAWN_INTERVAL_MS,
  ROOM_1_GOAL_COMBO,
  ROOM_3_DRIFTING_ORB_SPAWN_INTERVAL_MS,
  ROOM_DIFFICULTY_PADDLE_SHRINK_STEP,
  ROOM_DIFFICULTY_SPEED_STEP,
  ROOM_GOAL_COMBO_STEP_PER_ROOM,
  ROOM_MIN_PADDLE_WIDTH_RATIO,
} from './tuning';

// ADR-0015 §7/§12: two theme families ship as of MB-13 -- Focus/Tasks
// (Rooms 1-2, unchanged) and Rhythm/Calendar (Room 3, new).
export type RoomThemeId = 'focus-tasks' | 'rhythm-calendar';

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

// MB-09, ADR-0015 §10 (retirement note): the static breakable obstacle
// this function used to author into Room 2 was removed by explicit PO
// decision after playing Room 2 with both the obstacle and MB-08's drifting
// speed-orbs together -- the obstacle no longer added value alongside that
// mechanic. This function is kept, unused by any room right now, as the
// generic, documented entry point for a FUTURE room that wants an authored
// breakable obstacle: the engine-level capability (PongObstacleConfig/
// PongObstacleState/collision code in pongEngine.ts) was deliberately not
// removed. Both rooms are now symmetric on `obstacles` -- always [].
export function buildRoomObstacles(roomIndex: number, engineConfig: PongEngineConfig): readonly PongObstacleConfig[] {
  if (roomIndex !== 2) return []; // Room 1 stays obstacle-free by design (ADR-0015 §7/§10)

  // MB-09: Room 2 authors zero obstacles too now (ADR-0015 §10 retirement
  // note). `engineConfig` stays an unused parameter here, same as it
  // already was for Room 1's early return above -- kept so a future room
  // can be given obstacle geometry without changing this signature again.
  return [];
}

// MB-08, ADR-0015 §11 (amendment); MB-13, ADR-0015 §12: Rooms 2 and 3's
// drifting-orb spawn recipe. Radius scales with the room's own
// engineConfig.width (post-resize-safe, like buildRoomObstacles above);
// drift speed is a flat px/s value, NOT rescaled by board size -- matching
// this codebase's existing precedent for baseSpeed/maxSpeed
// (computeBoardConfig only rescales DIMENSIONAL fields, see that function's
// own comment), not a new inconsistency introduced here. Room 3's ONLY
// difference from Room 2 is spawn cadence (ROOM_3_DRIFTING_ORB_SPAWN_INTERVAL_MS,
// a tuning constant, not a new mechanic) -- same roles, effects, radius,
// drift speed, paddle/miss behavior.
export function buildDriftingOrbSpawnConfig(roomIndex: number, engineConfig: PongEngineConfig): PongDriftingOrbConfig | undefined {
  if (roomIndex < 2) return undefined; // Room 1 stays free of drifting orbs by design (ADR-0015 §7/§11)

  return {
    spawnIntervalMs: roomIndex >= 3 ? ROOM_3_DRIFTING_ORB_SPAWN_INTERVAL_MS : DRIFTING_ORB_SPAWN_INTERVAL_MS,
    driftSpeedPxPerSecond: DRIFTING_ORB_DRIFT_SPEED_PX_PER_SECOND,
    radius: engineConfig.width * DRIFTING_ORB_RADIUS_RATIO,
    rewardSpeedStep: DRIFTING_ORB_REWARD_SPEED_STEP,
    penaltySpeedStep: DRIFTING_ORB_PENALTY_SPEED_STEP,
  };
}

// ADR-0015 §4: base difficulty scales with room index ONLY -- adaptive
// correction from recent performance is explicitly deferred (do not
// implement it here). Every OTHER engine field (combo cap, final-wave
// fields) passes through from `base` untouched.
//
// MB-12 (fix): `durationSeconds` is deliberately NOT passed through
// untouched, unlike those other fields -- it is overridden to
// JOURNEY_UNBOUNDED_DURATION_SECONDS below. This comment previously (and
// incorrectly) claimed "Journey never uses durationSeconds as an end
// condition... so it's inert" -- true of THIS module's own code (stepJourney
// never reads config.durationSeconds or state.status), but false of the
// shared engine underneath it: pongEngine.ts's stepPong DOES use it, via
// `elapsedSeconds >= config.durationSeconds`, to set state.status to
// 'ended' -- and once 'ended', stepPong permanently no-ops on every future
// call (by design, for Quick Break's fixed-duration session -- see that
// function's own comment and pongEngine.test.ts's "the engine freezes state
// after that" test). Journey rooms inherited Quick Break's 90s default
// (DEFAULT_PONG_CONFIG.durationSeconds) with nothing to reset elapsedSeconds
// except a room-local restart (a miss) or a room transition -- so any
// single room attempt lasting 90 continuous seconds without either (most
// reachable in the 'cleared' phase, where no further room transition ever
// happens) silently and permanently stopped the ball/orbs/HUD, with the
// paddle still responding (it's set directly by the pointer handler,
// independent of this engine call) and no exception anywhere -- exactly the
// MB-12 report's symptom. Confirmed via a state dump (see the MB-12 report)
// showing stepPong returning the SAME PongState reference, unchanged, from
// t=90s onward. Fixed at the config layer, not by touching stepPong's
// ended-state freeze itself, since that freeze is correct, tested, load-
// bearing behavior for Quick Break's actually-timed sessions.
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
    // MB-10, ADR-0015 §11 (revision): scaled the SAME way as maxSpeed --
    // symmetric ceiling/floor, so a later room's harder baseSpeed doesn't
    // leave the floor representing a much smaller relative fraction of it
    // than Room 1 has.
    minSpeed: base.minSpeed * speedMultiplier,
    paddleWidth: base.paddleWidth * paddleShrinkMultiplier,
    durationSeconds: JOURNEY_UNBOUNDED_DURATION_SECONDS,
  };
}

// MB-12: see deriveRoomEngineConfig's own comment. Journey (ADR-0015 §1/§3)
// has no duration-based end condition at all -- ends only on explicit
// Esc/close, or (per-room) a goal-combo clear. Infinity, not just "a big
// number," makes that structurally true rather than merely improbable to
// hit: `elapsedSeconds >= Infinity` can never become true for any finite
// elapsedSeconds, so stepPong's ended-state freeze (correct and load-
// bearing for Quick Break) can never trigger for a Journey room.
const JOURNEY_UNBOUNDED_DURATION_SECONDS = Number.POSITIVE_INFINITY;

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

// ADR-0015 §7/§12: 3 rooms as of MB-13 (was exactly 2 pre-MB-13). Room 2 is
// a harder variant of Room 1 via room-index difficulty ONLY -- no new
// mechanic, no second theme. Room 3 introduces the SECOND (and, this slice,
// last) theme family, Rhythm/Calendar (§12) -- still no new mechanic; its
// only content lever is a faster drifting-orb spawn cadence (tuning.ts).
export function buildRoomSequence(boardConfig: PongEngineConfig): readonly RoomConfig[] {
  return [
    buildRoomConfig(1, 'focus-tasks', boardConfig),
    buildRoomConfig(2, 'focus-tasks', boardConfig),
    buildRoomConfig(3, 'rhythm-calendar', boardConfig),
  ];
}

// 'cleared': the LAST configured room's goal was reached (rooms.length,
// generalized -- see stepJourney's own isLastRoom check below, which reads
// rooms.length rather than a hardcoded room count, so this ALREADY
// generalized to 3 rooms with no code change needed here; verified
// explicitly by MB-13's own boundary test, not assumed). ADR-0015 §1/§3:
// Journey has no "game over" except explicit Esc/close -- rather than
// inventing further content or looping the sequence past the last authored
// room (out of scope either way), clearing the final room simply stops
// advancing: the room's own physics keep running (the ball keeps playing,
// still scorable) and the HUD acknowledges completion instead of
// transitioning again. See this module's own report section for this
// judgment call.
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
