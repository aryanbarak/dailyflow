import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { useVisibilityAwareGameLoop } from '../micro-breaks/engine/useVisibilityAwareGameLoop';
import {
  computeBoardConfig,
  computePaddleJumpOffsetPx,
  DEFAULT_PONG_CONFIG,
  requestPaddleJump,
  rescalePongState,
  setPaddleX,
  type PongEngineConfig,
} from '../micro-breaks/engine/pongEngine';
import { ORB_GRADIENT_STOPS, resolveOrbCanvasColors, useOrbVisualTokens } from '../micro-breaks/orbTokens';
import { setLastPointerPosition } from '../micro-breaks/pointerPositionRef';
import { createConvergingParticles, createHitParticles, type Particle } from '../micro-breaks/particles';
import {
  getParticleCountForMotionPreference,
  PARTICLE_LIFETIME_MS,
  SQUASH_DURATION_MS,
  TRAIL_LENGTH,
  TRAIL_LENGTH_REDUCED_MOTION,
} from '../micro-breaks/tuning';
import type { ViewportPoint } from '../micro-breaks/components/PongCanvas';
import { buildRoomSequence, createInitialJourneyState, stepJourney, type JourneyPhase, type JourneyState, type RoomConfig } from './roomEngine';
import {
  computeAbsorbPulseAlpha,
  computeJoltFlashIntensity,
  computeJoltShakeOffset,
  computeObstaclePulseAlpha,
  computePaddleCatchPulseAlpha,
  computeRoomTransitionFlashAlpha,
  drawDriftingOrbIdle,
  drawRoomObstacle,
  drawRoomTheme,
  resolveRoomThemeColors,
} from './roomTheme';
import {
  DRIFTING_ORB_ABSORB_PARTICLE_ARRIVAL_MS,
  DRIFTING_ORB_ABSORB_PULSE_DURATION_MS,
  DRIFTING_ORB_ABSORB_PULSE_PEAK_ALPHA,
  DRIFTING_ORB_JOLT_FLASH_DURATION_MS,
  DRIFTING_ORB_JOLT_FLASH_PEAK_ALPHA,
  DRIFTING_ORB_JOLT_SHAKE_DURATION_MS,
  DRIFTING_ORB_JOLT_SHAKE_MAGNITUDE_PX,
  DRIFTING_ORB_PADDLE_CATCH_PULSE_DURATION_MS,
  DRIFTING_ORB_PADDLE_CATCH_PULSE_PEAK_ALPHA,
  DRIFTING_ORB_PENALTY_RIM_DASH,
  DRIFTING_ORB_RIM_LINE_WIDTH,
  getDriftingOrbAbsorbParticleCount,
  getDriftingOrbJoltParticleCount,
  getDriftingOrbPaddleCatchParticleCount,
  getObstacleBreakParticleCount,
  getPaddleJumpHitGlowPeakAlpha,
  JOURNEY_PLAY_AREA_MAX_WIDTH_PX,
  PADDLE_JUMP_HIT_GLOW_DURATION_MS,
  PADDLE_JUMP_HIT_GLOW_RADIUS_MULTIPLIER,
  PADDLE_JUMP_TAP_MAX_DURATION_MS,
  PADDLE_JUMP_TAP_MAX_MOVEMENT_PX,
  ROOM_TRANSITION_FLASH_PEAK_ALPHA,
  ROOM_TRANSITION_SECONDS,
  ROOM_TRANSITION_SECONDS_REDUCED_MOTION,
} from './tuning';

export interface JourneyCanvasProps {
  /** Shared with the parent overlay for the entry handoff's "game start
   *  position" measurement, same pattern as PongCanvas's containerRef --
   *  see that component's own comment. */
  readonly containerRef: RefObject<HTMLDivElement>;
  /** MB-20, ADR-0015 §14: `score` is the SAME journeyScore value stepJourney
   *  just computed this tick (not a separately-read state), passed alongside
   *  roomIndex so a room-completion persistence write (fired from this
   *  callback in the parent overlay) never needs a second, potentially
   *  stale read of score -- see MicroBreakOverlay.tsx's own comment on its
   *  wrapped handler. */
  readonly onRoomChange: (roomIndex: number, score: number) => void;
  readonly onScoreChange: (score: number) => void;
  readonly onPhaseChange: (phase: JourneyPhase) => void;
  readonly viewportBallPositionRef?: MutableRefObject<ViewportPoint | null>;
  /** MB-02b/MB-03-FIX pattern, reused unchanged: called at most once if
   *  drawing throws. The overlay shows the SAME 'error' phase and exit path
   *  Quick Break already uses -- Journey does not get its own crash UI. */
  readonly onRenderError: (error: unknown) => void;
  /** MB-20, ADR-0015 §14: "Continue Journey" starts at the FIRST sub-state of
   *  the stored farthest_room, never mid-room physics -- this is the ONLY
   *  lever that changes, everything else about a continued session (paddle,
   *  score, missCount) is a fresh room start exactly like "New Journey"
   *  would produce for that room. Omitted (or 1) for "New Journey", unchanged
   *  from pre-MB-20 behavior. Clamped internally to a valid room index --
   *  the caller (MicroBreakOverlay.tsx) passes the raw stored value through
   *  without validating it against the current authored room count. */
  readonly startRoomIndex?: number;
}

// ADR-0015: a SEPARATE component from PongCanvas, deliberately -- not an
// extension of it. PongCanvas is Quick Break's tested, production code path;
// Journey's state shape (rooms, not a duration timer) is different enough
// that threading it through PongCanvas's branches would risk exactly what
// this slice's regression requirement forbids ("Classic Pong MUST remain
// completely unaffected"). This duplicates a small amount of canvas
// plumbing (resize/pointer/crash-guard wiring) from PongCanvas -- the
// REUSED, non-duplicated pieces are the actual constraint ADR-0015 §1 cares
// about: the physics engine (pongEngine.ts, via roomEngine.ts's
// stepJourney), the Orb's visual tokens (orbTokens.ts), and the particle/
// trail helpers (particles.ts, tuning.ts) -- see ADR-0015's own Consequences
// section, which anticipates this exact tradeoff ("a small ... system that
// did not exist before").
export function JourneyCanvas({
  containerRef,
  onRoomChange,
  onScoreChange,
  onPhaseChange,
  viewportBallPositionRef,
  onRenderError,
  startRoomIndex,
}: JourneyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardConfigRef = useRef<PongEngineConfig>(DEFAULT_PONG_CONFIG);
  // MB-20: `initialRooms` is a local (not roomsRef.current) so the SAME
  // array reference clamps startRoomIndex below AND seeds roomsRef/journeyRef
  // -- three reads of one value, not three separately-computed ones that
  // could disagree if buildRoomSequence's room count ever changed between
  // calls within a single render (it can't, but this keeps that invariant
  // structural rather than incidental, same reasoning this file already
  // applies elsewhere -- e.g. applyBoardSize's single nextRooms local).
  const initialRooms = buildRoomSequence(DEFAULT_PONG_CONFIG);
  const roomsRef = useRef<readonly RoomConfig[]>(initialRooms);
  // MB-20, ADR-0015 §14: "Continue Journey" starts at the first sub-state of
  // the stored farthest_room -- clamped to [1, initialRooms.length] here so
  // a stale/out-of-range stored value (e.g. authored room count later
  // shrinks) can never crash getRoom()'s own out-of-range throw.
  const clampedStartRoomIndex = Math.min(Math.max(startRoomIndex ?? 1, 1), initialRooms.length);
  const journeyRef = useRef<JourneyState>(createInitialJourneyState(initialRooms, clampedStartRoomIndex));
  const trailRef = useRef<ViewportPoint[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastRoomIndexRef = useRef(clampedStartRoomIndex);
  const lastScoreRef = useRef(0);
  const lastPhaseRef = useRef<JourneyPhase>('playing');
  const squashUntilRef = useRef(0);
  const transitionUntilRef = useRef(0);
  // MB-08, ADR-0015 §11 (amendment): the drifting-orb contact reaction
  // (Absorb/Jolt) is tracked as a single until-timestamp + role, mirroring
  // squashUntilRef/transitionUntilRef's own pattern -- the two reactions
  // are mutually exclusive (one contact resolved per substep, see
  // pongEngine.ts) so there is never a need to track both simultaneously.
  const driftingOrbReactionUntilRef = useRef(0);
  const driftingOrbReactionRoleRef = useRef<'reward' | 'penalty'>('reward');
  // NEW, MB-10, ADR-0015 §11 (revision): the penalty-role paddle-catch cue
  // (a successful defensive block) is tracked SEPARATELY from the
  // ball-contact Absorb/Jolt reaction above -- unlike those two (mutually
  // exclusive, drawn AT THE BALL), a paddle-catch can in principle occur in
  // the SAME tick as a different orb's ball contact (two independent orbs),
  // and it draws at a DIFFERENT screen location (the paddle), so it needs
  // its own until-timestamp rather than sharing driftingOrbReactionUntilRef.
  const paddleCatchReactionUntilRef = useRef(0);
  // MB-26, ADR-0015 §15: paddle jump-strike's own "stronger glow" reaction --
  // a separate until-timestamp from paddleCatchReactionUntilRef (a DIFFERENT
  // cue: this one always draws at the paddle's CURRENT -- possibly raised --
  // position, regardless of drifting-orb activity, and reuses a bigger
  // radius/peak-alpha, see tuning.ts's own comment on why it borrows
  // computePaddleCatchPulseAlpha's curve shape rather than inventing a new one).
  const paddleJumpHitGlowUntilRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const crashedRef = useRef(false);
  // MB-11: DEV-only fault-injection switch for the physics/update-path
  // crash-guard test -- there is no shared browser API to monkey-patch for
  // the physics path the way the render-path crash tests monkey-patch
  // canvas methods (roundRect/setLineDash/arc), so this is the direct
  // substitute: deterministically simulate "the update step threw" without
  // fabricating a genuine engine bug. Consumed and cleared by onTick.
  const forceNextTickThrowRef = useRef(false);
  const onRenderErrorRef = useRef(onRenderError);
  onRenderErrorRef.current = onRenderError;
  const tokens = useOrbVisualTokens();

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // MB-05: dev-only real-browser testability hook, mirroring this project's
  // existing /__dev/* harness routes (App.tsx) -- Orb Journey's real
  // physics cannot be reliably "auto-played" via simulated pointer input in
  // a deterministic Playwright test (no RNG, but paddle position must track
  // the ball's exact trajectory frame-by-frame; replicating that math in
  // the test script would just be a second, divergence-prone copy of
  // pongEngine.ts). Sets the CURRENT room's combo to its goal so the next
  // tick's normal stepJourney room-complete check fires through the real
  // code path -- this does not shortcut or duplicate the transition logic
  // itself. Stripped from production builds by Vite's dead-code elimination
  // on import.meta.env.DEV, the same guarantee the dev routes rely on.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const globalWindow = window as unknown as {
      __orbJourneyDevForceRoomGoal?: () => void;
      __orbJourneyDevForceObstacleContact?: () => void;
      __orbJourneyDevGetObstacleBrokenState?: () => readonly boolean[];
      __orbJourneyDevSpawnDriftingOrb?: (role: 'reward' | 'penalty') => void;
      __orbJourneyDevForceDriftingOrbContact?: () => void;
      __orbJourneyDevForcePaddleOrbCatch?: () => void;
      __orbJourneyDevForceOrbBottomMiss?: () => void;
      __orbJourneyDevGetBallSpeed?: () => number;
      __orbJourneyDevGetDriftingOrbCount?: () => number;
      __orbJourneyDevForceNextTickThrow?: () => void;
      __orbJourneyDevForceElapsedSeconds?: (seconds: number) => void;
      __orbJourneyDevGetDriftingOrbSpawnCount?: () => number;
      __orbJourneyDevGetBallFraction?: () => { x: number; y: number };
      __orbJourneyDevGetPaddleXFraction?: () => number;
      __orbJourneyDevForceFloorMiss?: () => void;
      __orbJourneyDevGetMissCount?: () => number;
      __orbJourneyDevIsReactionActive?: () => boolean;
      __orbJourneyDevTriggerPaddleJump?: () => void;
      __orbJourneyDevGetPaddleJumpState?: () => {
        active: boolean;
        elapsedMs: number;
        cooldownRemainingMs: number;
        hitCount: number;
        enabledThisRoom: boolean;
      };
    };
    globalWindow.__orbJourneyDevForceRoomGoal = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      if (!room) return;
      journeyRef.current = { ...journeyRef.current, pong: { ...journeyRef.current.pong, combo: room.goalCombo } };
    };
    // MB-07, ADR-0015 §10 (amendment): mirrors __orbJourneyDevForceRoomGoal's
    // own approach exactly -- manipulates STATE INPUTS only (ball position/
    // velocity, combo), then lets the real stepPong/integrateSubstep
    // collision-and-break logic run unmodified on the next tick. Used by
    // e2e/orbJourney.spec.ts to exercise the obstacle break path without
    // replicating pongEngine.ts's trajectory math in the test script.
    globalWindow.__orbJourneyDevForceObstacleContact = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      const obstacle = room?.obstacles[0];
      if (!room || !obstacle) return;
      const r = room.engineConfig.ballRadius;
      journeyRef.current = {
        ...journeyRef.current,
        pong: {
          ...journeyRef.current.pong,
          combo: Math.max(journeyRef.current.pong.combo, obstacle.comboThresholdToBreak ?? 0),
          ball: { x: obstacle.x + obstacle.width / 2, y: obstacle.y - r },
          ballVelocity: { x: 0, y: 300 },
        },
      };
    };
    // Read-only introspection for e2e assertions -- there is no HUD text for
    // obstacle state (unlike room/score), so this is the only way a
    // real-browser test can confirm "the obstacle is actually gone" without
    // pixel-diffing the canvas.
    globalWindow.__orbJourneyDevGetObstacleBrokenState = () => journeyRef.current.pong.obstacles.map(o => o.broken);
    // MB-08, ADR-0015 §11 (amendment): injects a drifting orb at a FIXED
    // position deliberately AWAY from the ball (near the top, where orbs
    // naturally spawn -- see roomEngine.ts's buildDriftingOrbSpawnConfig),
    // so it renders in its IDLE state for at least one real frame before
    // ever being caught -- unlike __orbJourneyDevForceObstacleContact's
    // "place it exactly at the contact point" approach, spawning AND
    // catching are deliberately split into two separate hooks here so a
    // test can observe idle rendering independent of the catch.
    globalWindow.__orbJourneyDevSpawnDriftingOrb = role => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      const spawnConfig = room?.driftingOrbSpawn;
      if (!room || !spawnConfig) return;
      journeyRef.current = {
        ...journeyRef.current,
        pong: {
          ...journeyRef.current.pong,
          driftingOrbs: [
            ...journeyRef.current.pong.driftingOrbs,
            { id: 'dev-spawned-orb', x: room.engineConfig.width * 0.5, y: spawnConfig.radius, role },
          ],
        },
      };
    };
    // Same "manipulate state inputs, let real physics run" methodology as
    // __orbJourneyDevForceObstacleContact -- teleports the ball onto the
    // FIRST currently-active drifting orb so the next tick's real
    // integrateSubstep contact-and-multiplier logic resolves it unmodified.
    globalWindow.__orbJourneyDevForceDriftingOrbContact = () => {
      const orb = journeyRef.current.pong.driftingOrbs[0];
      if (!orb) return;
      // Only the POSITION is teleported -- velocity is left exactly as the
      // ball's real, currently-in-flight speed, so the resulting
      // speed-multiplier effect is measured against a realistic baseline,
      // not an artificially near-zero one.
      journeyRef.current = { ...journeyRef.current, pong: { ...journeyRef.current.pong, ball: { x: orb.x, y: orb.y } } };
    };
    // NEW, MB-10, ADR-0015 §11 (revision): teleports the FIRST active
    // drifting orb onto the paddle (not the ball) so the next tick's real
    // circle-vs-paddle-rect contact logic resolves it unmodified -- same
    // "manipulate state inputs, let real physics run" methodology as the
    // ball-contact hook above. Used by e2e to prove a penalty-role orb
    // caught by the paddle causes NO speed change.
    globalWindow.__orbJourneyDevForcePaddleOrbCatch = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      const orb = journeyRef.current.pong.driftingOrbs[0];
      if (!room || !orb) return;
      journeyRef.current = {
        ...journeyRef.current,
        pong: {
          ...journeyRef.current.pong,
          driftingOrbs: journeyRef.current.pong.driftingOrbs.map(o =>
            o.id === orb.id ? { ...o, x: journeyRef.current.pong.paddleX, y: room.engineConfig.paddleY } : o,
          ),
        },
      };
    };
    // NEW, MB-10, ADR-0015 §11 (revision): teleports the FIRST active
    // drifting orb to well past the bottom edge (definitively past the
    // `orb.y - radius > config.height` removal condition already on the
    // very next substep, not just barely crossing it -- avoids relying on
    // one substep's small drift increment to cross a boundary, which would
    // be flakier in a real-browser test) so the next tick's real
    // bottom-miss logic resolves it unmodified.
    globalWindow.__orbJourneyDevForceOrbBottomMiss = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      const orb = journeyRef.current.pong.driftingOrbs[0];
      const spawnConfig = room?.driftingOrbSpawn;
      if (!room || !orb || !spawnConfig) return;
      journeyRef.current = {
        ...journeyRef.current,
        pong: {
          ...journeyRef.current.pong,
          driftingOrbs: journeyRef.current.pong.driftingOrbs.map(o =>
            o.id === orb.id ? { ...o, y: room.engineConfig.height + spawnConfig.radius + 10 } : o,
          ),
        },
      };
    };
    // Read-only introspection -- "catching a reward orb measurably increases
    // ball speed... a penalty orb measurably decreases it" needs a numeric
    // speed reading a real-browser test can before/after-compare.
    globalWindow.__orbJourneyDevGetBallSpeed = () => Math.hypot(journeyRef.current.pong.ballVelocity.x, journeyRef.current.pong.ballVelocity.y);
    // MB-10: needed so e2e's "paddle-catch causes NO speed change" test can
    // ALSO confirm the orb was actually removed -- an unchanged-speed
    // assertion alone can't be disproven by reverting the implementation
    // (a completely inert forcePaddleOrbCatch hook would ALSO leave speed
    // unchanged, passing trivially); pairing it with "the orb is gone" (a
    // fact that requires the real contact logic to have run) closes that gap.
    globalWindow.__orbJourneyDevGetDriftingOrbCount = () => journeyRef.current.pong.driftingOrbs.length;
    // MB-11: see forceNextTickThrowRef's own comment -- flips a switch
    // consumed by the NEXT onTick call, inside its try/catch, so a test can
    // deterministically prove the physics/update-path crash guard works
    // without needing to fabricate or wait for a genuine engine bug.
    globalWindow.__orbJourneyDevForceNextTickThrow = () => {
      forceNextTickThrowRef.current = true;
    };
    // MB-12: same "manipulate state inputs, let real physics run" pattern as
    // the other hooks above -- lets a real-browser test cheaply simulate
    // "many real minutes of continuous play" (needed to reach and cross the
    // pre-MB-12-fix 90s durationSeconds boundary, and well beyond it) without
    // an actual multi-minute real-time wait.
    globalWindow.__orbJourneyDevForceElapsedSeconds = seconds => {
      journeyRef.current = { ...journeyRef.current, pong: { ...journeyRef.current.pong, elapsedSeconds: seconds } };
    };
    // MB-13, ADR-0015 §12: read-only introspection -- "Room 3's drifting
    // orbs spawn measurably more frequently than Room 2's" needs a
    // CUMULATIVE, monotonic reading (pongEngine.ts's own
    // driftingOrbSpawnCount, unaffected by orbs later being caught/removed)
    // rather than the current active-orb count (__orbJourneyDevGetDriftingOrbCount
    // above), which fluctuates with removals and would make a spawn-rate
    // comparison flaky.
    globalWindow.__orbJourneyDevGetDriftingOrbSpawnCount = () => journeyRef.current.pong.driftingOrbSpawnCount;
    // MB-13: read-only introspection -- returns the ball's position as a
    // FRACTION (0..1) of the current room's board width/height, so a
    // real-browser test can drive real pointer input that tracks the ball
    // (keeping the room in play, avoiding restart-driven resets of
    // driftingOrbSpawnElapsedMs) WITHOUT needing to separately know
    // engineConfig.width/height, which isn't otherwise exposed.
    globalWindow.__orbJourneyDevGetBallFraction = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      if (!room) return { x: 0.5, y: 0.5 };
      return { x: journeyRef.current.pong.ball.x / room.engineConfig.width, y: journeyRef.current.pong.ball.y / room.engineConfig.height };
    };
    // MB-18, ADR-0015 §3 (correction): same "manipulate state inputs, let
    // real physics run" methodology as __orbJourneyDevForceOrbBottomMiss --
    // positions the ball definitively PAST the floor (not just barely
    // crossing it, so this doesn't depend on one substep's small drift
    // increment) with a downward velocity, so the next tick's REAL
    // integrateSubstep floor-miss branch (pongEngine.ts) resolves it
    // unmodified -- this does not shortcut or duplicate stepJourney's own
    // grace/full-restart branching. Positioned well below paddleBottom too,
    // so `hitPaddle`'s own y-band check can never accidentally intercept it
    // regardless of where the paddle currently is.
    globalWindow.__orbJourneyDevForceFloorMiss = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      if (!room) return;
      const config = room.engineConfig;
      journeyRef.current = {
        ...journeyRef.current,
        pong: { ...journeyRef.current.pong, ball: { x: config.width * 0.5, y: config.height + config.ballRadius + 5 }, ballVelocity: { x: 0, y: 300 } },
      };
    };
    // Read-only introspection -- MB-18's own room-local two-strike counter,
    // not otherwise observable from outside (no HUD text for it, by
    // design -- see the MB-18 report's own manual-verification section).
    globalWindow.__orbJourneyDevGetMissCount = () => journeyRef.current.missCount;
    // MB-18: read-only introspection -- lets a test verify the grace-miss
    // visual cue's underlying TRIGGER actually fired (driftingOrbReactionUntilRef/
    // RoleRef, the SAME shared reaction state the existing penalty-role
    // drifting-orb Jolt reaction already uses and already renders correctly
    // -- this hook proves the grace path reuses/reaches that same code, not
    // that the Jolt drawing routine itself is correct, which is already
    // covered by existing drifting-orb reaction coverage).
    globalWindow.__orbJourneyDevIsReactionActive = () => performance.now() < driftingOrbReactionUntilRef.current;
    // MB-26: read-only introspection -- lets a real-browser test confirm
    // drag-to-move actually moved the paddle, the same fraction-of-board
    // idiom __orbJourneyDevGetBallFraction already established for the ball.
    globalWindow.__orbJourneyDevGetPaddleXFraction = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      if (!room) return 0.5;
      return journeyRef.current.pong.paddleX / room.engineConfig.width;
    };
    // MB-26, ADR-0015 §15: mirrors every other force-* hook's "manipulate a
    // state input via the REAL public function, let physics run unmodified"
    // methodology -- this one literally IS the real public entry point
    // (requestPaddleJump), so there is nothing to shortcut: room-gating,
    // cooldown, and the hop timing all still resolve exactly as the real
    // keyboard/touch handlers would trigger them.
    globalWindow.__orbJourneyDevTriggerPaddleJump = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      if (!room) return;
      journeyRef.current = { ...journeyRef.current, pong: requestPaddleJump(journeyRef.current.pong, room.engineConfig) };
    };
    // Read-only introspection -- there is no HUD text for jump state (same
    // reasoning as missCount/obstacle-broken-state above), so this is the
    // only way a real-browser test can confirm the hop/cooldown/hit-count
    // actually advanced without pixel-diffing the canvas.
    globalWindow.__orbJourneyDevGetPaddleJumpState = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      const pong = journeyRef.current.pong;
      return {
        active: pong.paddleJumpActive,
        elapsedMs: pong.paddleJumpElapsedMs,
        cooldownRemainingMs: pong.paddleJumpCooldownRemainingMs,
        hitCount: pong.paddleJumpHitCount,
        enabledThisRoom: Boolean(room?.engineConfig.paddleJump),
      };
    };
    return () => {
      delete globalWindow.__orbJourneyDevForceRoomGoal;
      delete globalWindow.__orbJourneyDevForceObstacleContact;
      delete globalWindow.__orbJourneyDevGetObstacleBrokenState;
      delete globalWindow.__orbJourneyDevSpawnDriftingOrb;
      delete globalWindow.__orbJourneyDevForceDriftingOrbContact;
      delete globalWindow.__orbJourneyDevForcePaddleOrbCatch;
      delete globalWindow.__orbJourneyDevForceOrbBottomMiss;
      delete globalWindow.__orbJourneyDevGetBallSpeed;
      delete globalWindow.__orbJourneyDevGetDriftingOrbCount;
      delete globalWindow.__orbJourneyDevForceNextTickThrow;
      delete globalWindow.__orbJourneyDevForceElapsedSeconds;
      delete globalWindow.__orbJourneyDevGetDriftingOrbSpawnCount;
      delete globalWindow.__orbJourneyDevGetBallFraction;
      delete globalWindow.__orbJourneyDevForceFloorMiss;
      delete globalWindow.__orbJourneyDevGetMissCount;
      delete globalWindow.__orbJourneyDevIsReactionActive;
      delete globalWindow.__orbJourneyDevTriggerPaddleJump;
      delete globalWindow.__orbJourneyDevGetPaddleJumpState;
      delete globalWindow.__orbJourneyDevGetPaddleXFraction;
    };
  }, []);

  // Same resize/rescale wiring as PongCanvas (see that component's own
  // comment for the ResizeObserver-undefined fallback rationale) --
  // re-derives EVERY room's engineConfig from the new board size so a
  // resize mid-journey doesn't leave later rooms sized for the old board.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applyBoardSize = (widthPx: number, heightPx: number) => {
      if (widthPx <= 0 || heightPx <= 0) return;
      // MB-22, ADR-0015 §13 (retirement): JOURNEY_PLAY_AREA_MAX_WIDTH_PX is
      // now a fixed constant, identical for every room -- the room-index
      // growth formula this used to call (getJourneyPlayAreaMaxWidthPx) is
      // removed, not just unused. Still the SAME value driving BOTH this
      // and the play-area container's own CSS max-width in
      // MicroBreakOverlay.tsx -- one constant feeding both, not two
      // separately-tuned numbers (see that constant's own comment).
      const nextBoardConfig = computeBoardConfig(widthPx, heightPx, boardConfigRef.current, JOURNEY_PLAY_AREA_MAX_WIDTH_PX);
      const prevBoardConfig = boardConfigRef.current;
      if (nextBoardConfig.width === prevBoardConfig.width && nextBoardConfig.height === prevBoardConfig.height) return;

      const nextRooms = buildRoomSequence(nextBoardConfig);
      const currentRoomIndex = journeyRef.current.roomIndex;
      const prevRoomEngineConfig = roomsRef.current[currentRoomIndex - 1]?.engineConfig ?? prevBoardConfig;
      const nextRoomEngineConfig = nextRooms[currentRoomIndex - 1]?.engineConfig ?? nextBoardConfig;

      journeyRef.current = {
        ...journeyRef.current,
        pong: rescalePongState(journeyRef.current.pong, prevRoomEngineConfig, nextRoomEngineConfig),
      };
      roomsRef.current = nextRooms;
      boardConfigRef.current = nextBoardConfig;

      // MB-17, ADR-0015 §13 (correction): the canvas's CSS display size is
      // now set EXPLICITLY from the SAME nextBoardConfig numbers driving the
      // buffer below, in the SAME place, atomically -- not inherited via
      // `width:100%/height:100%` from the parent container. Diagnosed root
      // cause (see the MB-17 report for the real-browser evidence): the
      // parent container's own CSS box (`w-full max-w-[journeyMaxWidthPx]
      // aspect-ratio maxHeight:min(70vh,720px)`) can legitimately render
      // WIDER than a true 2:3-aspect box once maxHeight binds tighter than
      // the width chain implies (a standard, spec-correct CSS aspect-ratio
      // limitation -- max-width and max-height are each applied
      // independently when width is already definite, so the box is NOT
      // retroactively narrowed to stay 2:3). The buffer (below) was ALREADY
      // being recalculated correctly and promptly on every resize -- it
      // reads the container's REAL measured size and fits the more
      // constraining axis (the same min(containerWidth, containerHeight *
      // aspectRatio) logic computeBoardConfig always used) -- so it was
      // never stale. The bug was that the CANVAS's own CSS box, inherited at
      // 100%/100% from that same (possibly distorted) container, did NOT
      // match the buffer's correctly-fitted aspect ratio -- the browser then
      // stretched the buffer non-uniformly to fill the larger box, rendering
      // the ball as an ellipse. Pinning the canvas's CSS width/height to the
      // exact same nextBoardConfig numbers as the buffer makes the two
      // impossible to diverge, regardless of the parent container's own
      // shape; the container centers this (possibly narrower) canvas via
      // flexbox (see MicroBreakOverlay.tsx's Journey container className).
      canvas.style.width = `${nextBoardConfig.width}px`;
      canvas.style.height = `${nextBoardConfig.height}px`;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = nextBoardConfig.width * dpr;
      canvas.height = nextBoardConfig.height * dpr;
      canvas.getContext('2d')?.scale(dpr, dpr);
    };

    const handleOrientationChange = () => {
      const rect = container.getBoundingClientRect();
      applyBoardSize(rect.width, rect.height);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    if (typeof ResizeObserver === 'undefined') {
      const rect = container.getBoundingClientRect();
      applyBoardSize(rect.width, rect.height);
      return () => window.removeEventListener('orientationchange', handleOrientationChange);
    }

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      applyBoardSize(width, height);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same pointer-input wiring as PongCanvas (ADR-0014 §11's single Pointer
  // Events path, unchanged) -- paddle X only, from the CURRENT room's
  // engineConfig. MB-26, ADR-0015 §15: extended (not forked into a second
  // path) with tap-vs-drag detection for the paddle jump-strike's touch/
  // mouse trigger -- pointerdown/pointermove above are UNTOUCHED, so
  // drag-to-move (including a drag that starts slowly) behaves exactly as
  // before; only a NEW pointerup listener decides, after the fact, whether
  // what just happened was a tap.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toLocalX = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const currentConfig = roomsRef.current[journeyRef.current.roomIndex - 1]?.engineConfig ?? boardConfigRef.current;
      const ratio = rect.width === 0 ? 1 : currentConfig.width / rect.width;
      return (clientX - rect.left) * ratio;
    };

    const movePaddle = (event: PointerEvent) => {
      setLastPointerPosition(event.clientX, event.clientY);
      const currentConfig = roomsRef.current[journeyRef.current.roomIndex - 1]?.engineConfig ?? boardConfigRef.current;
      journeyRef.current = { ...journeyRef.current, pong: setPaddleX(journeyRef.current.pong, toLocalX(event.clientX), currentConfig) };
    };

    // MB-26: per-pointer down info (time + start position), keyed by
    // pointerId so a stray second pointer's up event can never be
    // misattributed to the FIRST pointer's own down -- Pointer Events can
    // in principle deliver interleaved streams for multiple simultaneous
    // touches, even though this feature's PRIMARY trigger (tap detection)
    // only ever looks at a single pointer's own down/up pair.
    const pointerDownInfoRef = new Map<number, { readonly time: number; readonly x: number; readonly y: number }>();

    const triggerJumpIfEnabled = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      if (!room?.engineConfig.paddleJump) return; // room-gated no-op, Rooms 1-2
      journeyRef.current = { ...journeyRef.current, pong: requestPaddleJump(journeyRef.current.pong, room.engineConfig) };
    };

    const handlePointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      pointerDownInfoRef.set(event.pointerId, { time: performance.now(), x: event.clientX, y: event.clientY });
      movePaddle(event);
    };
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      movePaddle(event);
    };
    // MB-26, ADR-0015 §15: "a quick tap (short press without significant
    // drag)" -- chosen over "a second concurrent pointer" as this feature's
    // primary touch trigger (see tuning.ts's own comment on the tradeoff).
    // Deliberately does NOT call movePaddle or preventDefault -- an up event
    // carries no new paddle position, and touch-scroll prevention is
    // already handled at the overlay root (MicroBreakOverlay.tsx's
    // touchAction/overscrollBehavior styling) and by pointerdown/move above.
    const handlePointerUp = (event: PointerEvent) => {
      const down = pointerDownInfoRef.get(event.pointerId);
      pointerDownInfoRef.delete(event.pointerId);
      if (!down) return;
      const elapsedMs = performance.now() - down.time;
      const movedPx = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (elapsedMs > PADDLE_JUMP_TAP_MAX_DURATION_MS || movedPx > PADDLE_JUMP_TAP_MAX_MOVEMENT_PX) return; // a drag, not a tap
      triggerJumpIfEnabled();
    };
    const handlePointerCancel = (event: PointerEvent) => {
      pointerDownInfoRef.delete(event.pointerId);
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, []);

  // MB-26, ADR-0015 §15: Space-triggered jump-strike, on `document` (not the
  // canvas -- the canvas is `aria-hidden`/never focusable, so the actually-
  // focused element during an active Journey session is the overlay's own
  // close button, MicroBreakOverlay.tsx's `closeButtonRef`). This effect's
  // mount/unmount lifecycle already IS "while a Journey session is active"
  // (JourneyCanvas only mounts then), so no extra phase check is needed
  // here. `event.preventDefault()` runs UNCONDITIONALLY on a real, non-
  // repeat Space keydown -- BEFORE the room-gate check below -- because the
  // accidental-exit risk (Space's default keyboard-activation of a focused
  // <button>) applies for the whole session, not just Room 3+; only the
  // actual jump TRIGGER is room-gated, via the same requestPaddleJump
  // no-op-when-ungated path the touch handler above already uses.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.code !== 'Space') return;
      if (event.repeat) return; // ignore auto-repeat -- one press, one jump attempt
      event.preventDefault();
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      if (!room?.engineConfig.paddleJump) return; // room-gated no-op, Rooms 1-2
      journeyRef.current = { ...journeyRef.current, pong: requestPaddleJump(journeyRef.current.pong, room.engineConfig) };
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // MB-11: single source of truth for "the game crashed, show the
  // recoverable error state" -- both the render-path guard (draw(), below)
  // and the physics/update-path guard (onTick's own try/catch, further
  // down) call this SAME function on failure, rather than each doing its
  // own crashedRef/onRenderErrorRef bookkeeping.
  function crash(error: unknown) {
    crashedRef.current = true;
    onRenderErrorRef.current(error);
  }

  // MB-02b/MB-03-FIX pattern, reused unchanged (see PongCanvas.tsx's own
  // comment): draw() is the ONLY thing allowed to call renderFrame(), and
  // guarantees the exception never escapes uncaught.
  function draw() {
    if (crashedRef.current) return;
    try {
      renderFrame();
    } catch (error) {
      crash(error);
    }
  }

  function renderFrame() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const journey = journeyRef.current;
    const room = roomsRef.current[journey.roomIndex - 1];
    if (!room) return;
    const config = room.engineConfig;
    const state = journey.pong;
    const colors = resolveOrbCanvasColors(tokens);
    const themeColors = resolveRoomThemeColors(room.theme);
    const reducedMotion = reducedMotionRef.current;
    const now = performance.now();

    ctx.clearRect(0, 0, config.width, config.height);

    // ADR-0015 §5: room theme drawn first, behind everything else.
    // Progress towards THIS room's goal (not the whole journey) brightens
    // the theme -- see roomTheme.ts's own comment.
    const progress = room.goalCombo > 0 ? state.combo / room.goalCombo : 0;
    drawRoomTheme(ctx, { width: config.width, height: config.height }, room.theme, themeColors, progress);

    // ADR-0015 §10 (amendment), MB-07: obstacles drawn above the decorative
    // background but below the trail/particles/paddle/ball -- a midground
    // gameplay layer. Skips any already broken this room instance; state
    // and config obstacle arrays are always the same length/order (see
    // roomEngine.ts's buildRoomConfig -- one array reference feeds both).
    const pulseAlpha = computeObstaclePulseAlpha(now, reducedMotion);
    room.obstacles.forEach((obstacleConfig, index) => {
      if (state.obstacles[index]?.broken) return;
      drawRoomObstacle(ctx, obstacleConfig, themeColors, obstacleConfig.breakable, pulseAlpha);
    });

    // ADR-0015 §11 (amendment), MB-08: drifting orbs -- idle (pre-contact)
    // appearance ONLY here; the reaction (Absorb/Jolt) is drawn later,
    // layered with the ball, since it visually happens AT the ball once the
    // orb is caught and removed from state.driftingOrbs. The rim-shape
    // distinction (smooth vs notched) is NEVER gated by reduced motion --
    // it's a static shape, not animation.
    if (room.driftingOrbSpawn) {
      const orbRadius = room.driftingOrbSpawn.radius;
      state.driftingOrbs.forEach(orb => {
        drawDriftingOrbIdle(ctx, { x: orb.x, y: orb.y }, orbRadius, orb.role, colors, {
          lineWidth: DRIFTING_ORB_RIM_LINE_WIDTH,
          penaltyDash: DRIFTING_ORB_PENALTY_RIM_DASH,
        });
      });
    }

    const trail = trailRef.current;
    const maxTrail = reducedMotion ? TRAIL_LENGTH_REDUCED_MOTION : TRAIL_LENGTH;
    trail.push({ x: state.ball.x, y: state.ball.y });
    while (trail.length > maxTrail) trail.shift();
    trail.forEach((point, index) => {
      const alpha = Math.min(1, ((index + 1) / trail.length) * 0.25);
      ctx.beginPath();
      ctx.fillStyle = colors.glow(alpha);
      ctx.arc(point.x, point.y, config.ballRadius * 0.8, 0, Math.PI * 2);
      ctx.fill();
    });

    const particles = particlesRef.current;
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      const age = now - particle.bornAt;
      if (age > PARTICLE_LIFETIME_MS) {
        particles.splice(i, 1);
        continue;
      }
      const lifeFraction = 1 - age / PARTICLE_LIFETIME_MS;
      particle.x += particle.vx * 0.016;
      particle.y += particle.vy * 0.016;
      ctx.beginPath();
      ctx.fillStyle = colors.glow(lifeFraction * 0.6);
      ctx.arc(particle.x, particle.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // MB-26, ADR-0015 §15: the SAME computePaddleJumpOffsetPx the engine
    // itself uses for collision (pongEngine.ts) -- drawing at this exact
    // offset is what makes the paddle's VISUAL position match where it
    // actually collides, one source of truth rather than a second,
    // independently-tuned animation.
    const jumpOffsetPx =
      room.engineConfig.paddleJump && state.paddleJumpActive
        ? computePaddleJumpOffsetPx(state.paddleJumpElapsedMs, room.engineConfig.paddleJump, config.height)
        : 0;
    const paddleDrawY = config.paddleY - jumpOffsetPx;

    ctx.save();
    ctx.shadowColor = colors.glow(0.8);
    ctx.shadowBlur = reducedMotion ? 0 : 16;
    ctx.fillStyle = colors.core;
    const paddleLeft = state.paddleX - config.paddleWidth / 2;
    ctx.beginPath();
    ctx.roundRect(paddleLeft, paddleDrawY, config.paddleWidth, config.paddleHeight, 7);
    ctx.fill();
    ctx.restore();

    // NEW, MB-10, ADR-0015 §11 (revision): penalty-role paddle-catch cue --
    // a minimal glow ring at the paddle, distinct from Absorb/Jolt (which
    // both draw AT THE BALL). Never gated by reduced motion at this layer,
    // same convention as the flash/pulse color cues below. Deliberately
    // drawn at the GROUNDED config.paddleY, not paddleDrawY -- the
    // drifting-orb/paddle interaction it represents always reads the
    // grounded rect too (pongEngine.ts, out of this feature's scope), so
    // the cue stays visually honest about where that catch really happened.
    if (now < paddleCatchReactionUntilRef.current) {
      const paddleCatchElapsedMs = DRIFTING_ORB_PADDLE_CATCH_PULSE_DURATION_MS - (paddleCatchReactionUntilRef.current - now);
      const paddleCatchAlpha = computePaddleCatchPulseAlpha(
        paddleCatchElapsedMs,
        DRIFTING_ORB_PADDLE_CATCH_PULSE_DURATION_MS,
        DRIFTING_ORB_PADDLE_CATCH_PULSE_PEAK_ALPHA,
      );
      if (paddleCatchAlpha > 0) {
        ctx.beginPath();
        ctx.fillStyle = colors.glow(paddleCatchAlpha);
        ctx.arc(state.paddleX, config.paddleY + config.paddleHeight / 2, config.paddleHeight * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // NEW, MB-26, ADR-0015 §15: "a hit made while jumping additionally
    // applies... a stronger paddle-glow feedback." Reuses
    // computePaddleCatchPulseAlpha's own rise-then-fall envelope (task
    // brief: "reuse existing primitives") at a bigger peak alpha/radius, so
    // it reads as visually distinct from (and more emphatic than) the
    // penalty-catch cue above. Drawn at paddleDrawY -- the paddle's OWN
    // current (possibly raised) position, since this cue represents THIS
    // paddle's own jump-hit, unlike the catch cue above.
    if (now < paddleJumpHitGlowUntilRef.current) {
      const jumpGlowElapsedMs = PADDLE_JUMP_HIT_GLOW_DURATION_MS - (paddleJumpHitGlowUntilRef.current - now);
      const jumpGlowAlpha = computePaddleCatchPulseAlpha(
        jumpGlowElapsedMs,
        PADDLE_JUMP_HIT_GLOW_DURATION_MS,
        getPaddleJumpHitGlowPeakAlpha(reducedMotion),
      );
      if (jumpGlowAlpha > 0) {
        ctx.beginPath();
        ctx.fillStyle = colors.glow(jumpGlowAlpha);
        ctx.arc(state.paddleX, paddleDrawY + config.paddleHeight / 2, config.paddleHeight * PADDLE_JUMP_HIT_GLOW_RADIUS_MULTIPLIER, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const squashing = !reducedMotion && now < squashUntilRef.current;
    const scaleX = squashing ? 1.3 : 1;
    const scaleY = squashing ? 0.7 : 1;

    // ADR-0015 §11 (amendment), MB-08: Jolt's small, bounded, short-duration
    // shake -- reduced-motion-gated (returns {0,0} when reducedMotion is
    // true), applied only to the DRAWN position, never the real physics
    // position. Absorb has no shake at all (only Jolt/penalty does).
    const inReactionWindow = now < driftingOrbReactionUntilRef.current;
    const reactionRole = driftingOrbReactionRoleRef.current;
    const reactionTotalMs = reactionRole === 'reward' ? DRIFTING_ORB_ABSORB_PULSE_DURATION_MS : DRIFTING_ORB_JOLT_FLASH_DURATION_MS;
    const reactionElapsedMs = inReactionWindow ? reactionTotalMs - (driftingOrbReactionUntilRef.current - now) : 0;
    const shake =
      inReactionWindow && reactionRole === 'penalty'
        ? computeJoltShakeOffset(now, reactionElapsedMs, DRIFTING_ORB_JOLT_SHAKE_DURATION_MS, DRIFTING_ORB_JOLT_SHAKE_MAGNITUDE_PX, reducedMotion)
        : { dx: 0, dy: 0 };

    ctx.save();
    ctx.translate(state.ball.x + shake.dx, state.ball.y + shake.dy);
    ctx.scale(scaleX, scaleY);

    const glowRadius = config.ballRadius * 2.2;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    gradient.addColorStop(0, colors.glow(ORB_GRADIENT_STOPS.coreWhiteAlpha));
    gradient.addColorStop(ORB_GRADIENT_STOPS.innerColorStop, colors.glow(ORB_GRADIENT_STOPS.innerColorAlpha));
    gradient.addColorStop(ORB_GRADIENT_STOPS.outerColorStop, colors.glow(ORB_GRADIENT_STOPS.outerColorAlpha));
    gradient.addColorStop(ORB_GRADIENT_STOPS.transparentStop, 'transparent');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = colors.core;
    ctx.beginPath();
    ctx.arc(0, 0, config.ballRadius, 0, Math.PI * 2);
    ctx.fill();

    // ADR-0015 §11 (amendment), MB-08: the flash/pulse color cue -- NEVER
    // gated by reduced motion (a static brightness change, not motion),
    // unlike the particles/shake above. Absorb: a single smooth fade-out.
    // Jolt: a sharp bright-dim-bright double-flash -- deliberately a
    // different curve shape, not just a different color, so the two
    // reactions are distinguishable even if color perception varies.
    if (inReactionWindow) {
      const reactionAlpha =
        reactionRole === 'reward'
          ? computeAbsorbPulseAlpha(reactionElapsedMs, reactionTotalMs, DRIFTING_ORB_ABSORB_PULSE_PEAK_ALPHA)
          : computeJoltFlashIntensity(reactionElapsedMs, reactionTotalMs) * DRIFTING_ORB_JOLT_FLASH_PEAK_ALPHA;
      if (reactionAlpha > 0) {
        ctx.beginPath();
        ctx.fillStyle = colors.glow(reactionAlpha);
        ctx.arc(0, 0, glowRadius * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // ADR-0015 §2/Build 4: short, reduced-motion-aware room-transition
    // flash -- a brief accent-colored wash, entirely absent under reduced
    // motion (ROOM_TRANSITION_SECONDS_REDUCED_MOTION is 0, so
    // transitionUntilRef is never set ahead of `now` in that case).
    // MB-06: the alpha envelope (computeRoomTransitionFlashAlpha, unit-
    // tested in roomTheme.test.ts) eases in AND out over the window -- the
    // previous version jumped straight to peak alpha the instant the
    // transition started (a hard cut on entry) and only eased out.
    if (!reducedMotion && now < transitionUntilRef.current) {
      const remainingMs = transitionUntilRef.current - now;
      const totalMs = ROOM_TRANSITION_SECONDS * 1000;
      const elapsedMs = totalMs - remainingMs;
      const fadeAlpha = computeRoomTransitionFlashAlpha(elapsedMs, totalMs, ROOM_TRANSITION_FLASH_PEAK_ALPHA);
      ctx.fillStyle = themeColors.accent(fadeAlpha);
      ctx.fillRect(0, 0, config.width, config.height);
    }

    if (viewportBallPositionRef) {
      const rect = canvas.getBoundingClientRect();
      const scaleToViewport = rect.width === 0 ? 1 : rect.width / config.width;
      viewportBallPositionRef.current = {
        x: rect.left + state.ball.x * scaleToViewport,
        y: rect.top + state.ball.y * scaleToViewport,
      };
    }
  }

  useVisibilityAwareGameLoop({
    active: true,
    onTick: dtMs => {
      if (crashedRef.current) return;
      // MB-11 (High-severity fix): the physics step (stepJourney) and the
      // VFX-detection/particle-creation logic below it were PREVIOUSLY
      // unguarded -- only draw()/renderFrame() had crash-guard coverage
      // (the MB-02b/MB-03-FIX pattern). An uncaught exception anywhere in
      // this block would propagate out of onTick, which
      // useVisibilityAwareGameLoop calls with NO try/catch of its own
      // (confirmed by reading that hook's source) -- since the exception
      // aborts the rAF callback's synchronous execution BEFORE it reaches
      // its own `requestAnimationFrame(tick)` call, the animation chain
      // silently stops forever: no error overlay (draw() is never reached),
      // while independent event listeners (pointermove for the paddle)
      // keep firing normally, since they don't depend on the dead rAF
      // chain. This exactly matches the reported symptom (freeze, no crash
      // screen, paddle input still registers). See the MB-11 report for the
      // fuzz-soak methodology used to try to reproduce a NATURAL throw
      // (none found across ~2,500 iterations / 90s of aggressive same-tick
      // multi-orb/forced-restart stress) -- this fix closes the structural
      // gap regardless, since ANY future exception here (not just
      // drifting-orb-related ones) is now covered the same way rendering
      // already is, via the SAME crash() function -- a single source of
      // truth, not a second, different error path.
      try {
        // DEV-only fault-injection switch, consumed once -- lets a test
        // deterministically prove this guard works without needing to
        // fabricate or wait for a genuine engine bug (see
        // forceNextTickThrowRef's own comment).
        if (forceNextTickThrowRef.current) {
          forceNextTickThrowRef.current = false;
          throw new Error('MB-11 test-injected physics/update-step failure');
        }

        const prevRoomIndex = journeyRef.current.roomIndex;
        const prevScore = journeyRef.current.journeyScore;
        const prevPongScore = journeyRef.current.pong.score;
        const prevObstacles = journeyRef.current.pong.obstacles;
        const prevRewardContactCount = journeyRef.current.pong.rewardContactCount;
        const prevPenaltyBallContactCount = journeyRef.current.pong.penaltyBallContactCount;
        const prevPenaltyPaddleCatchCount = journeyRef.current.pong.penaltyPaddleCatchCount;
        const prevPenaltyBottomMissCount = journeyRef.current.pong.penaltyBottomMissCount;
        // MB-18, ADR-0015 §3 (correction): needed to detect "the 1st,
        // grace-path miss just happened THIS tick" -- see the reaction block
        // below.
        const prevMissCount = journeyRef.current.missCount;
        // MB-26, ADR-0015 §15: needed to detect "a jump-hit just happened
        // THIS tick" -- same before/after-diff idiom as every other counter
        // captured above.
        const prevPaddleJumpHitCount = journeyRef.current.pong.paddleJumpHitCount;
        const next = stepJourney(journeyRef.current, dtMs, roomsRef.current);
        journeyRef.current = next;

        if (next.pong.score !== prevPongScore) {
          squashUntilRef.current = performance.now() + SQUASH_DURATION_MS;
          const particleCount = getParticleCountForMotionPreference(reducedMotionRef.current);
          if (particleCount > 0) {
            particlesRef.current.push(...createHitParticles(next.pong.ball.x, next.pong.ball.y, particleCount, performance.now()));
          }
        }

        // NEW, MB-26, ADR-0015 §15: "a hit made while jumping additionally
        // applies... a stronger paddle-glow feedback." The normal squash/
        // particle burst above ALREADY fires for a jump-hit too (it is
        // still a score-changing paddle hit) -- this only adds the EXTRA
        // glow cue, not a duplicate of the base hit feedback.
        if (next.pong.paddleJumpHitCount > prevPaddleJumpHitCount) {
          paddleJumpHitGlowUntilRef.current = performance.now() + PADDLE_JUMP_HIT_GLOW_DURATION_MS;
        }

        // ADR-0015 §10 (amendment), MB-07: break VFX. Only checked when still
        // in the SAME room this tick (a room transition already replaces
        // `pong` with the NEXT room's fresh state, whose obstacles can't be
        // meaningfully diffed against the PREVIOUS room's) -- geometrically
        // a break and a room-clearing paddle hit can't occur in the same
        // substep anyway (the obstacle sits far from the paddle band), so this
        // guard is a correctness safeguard, not a workaround for something
        // observed to actually happen.
        if (next.roomIndex === prevRoomIndex) {
          const currentRoom = roomsRef.current[next.roomIndex - 1];
          if (currentRoom) {
            next.pong.obstacles.forEach((obstacleState, index) => {
              const prevObstacleState = prevObstacles[index];
              if (!obstacleState.broken || !prevObstacleState || prevObstacleState.broken) return;
              const obstacleConfig = currentRoom.obstacles[index];
              if (!obstacleConfig) return;
              const burstCount = getObstacleBreakParticleCount(reducedMotionRef.current);
              if (burstCount > 0) {
                const centerX = obstacleConfig.x + obstacleConfig.width / 2;
                const centerY = obstacleConfig.y + obstacleConfig.height / 2;
                particlesRef.current.push(...createHitParticles(centerX, centerY, burstCount, performance.now()));
              }
            });
          }
        }

        // MB-10, ADR-0015 §11 (revision): drifting-orb reactions. Detected via
        // the 4 monotonic counters (pongEngine.ts), each diffed independently
        // -- replaces MB-08's single speedMultiplierExpiresAt-diff, which no
        // longer exists (effects aren't timed anymore, so "expiry" as a
        // concept is gone). Reward and the two ball-position penalty outcomes
        // (direct ball contact, bottom-miss) all share the SAME ball-centered
        // Absorb/Jolt visual (driftingOrbReactionUntilRef) -- the paddle-catch
        // outcome is entirely separate (paddleCatchReactionUntilRef), drawn at
        // the paddle, and carries no speed change at all.
        if (next.roomIndex === prevRoomIndex) {
          const rewardHappened = next.pong.rewardContactCount > prevRewardContactCount;
          const penaltyBallHappened = next.pong.penaltyBallContactCount > prevPenaltyBallContactCount;
          const penaltyBottomMissHappened = next.pong.penaltyBottomMissCount > prevPenaltyBottomMissCount;
          const paddleCatchHappened = next.pong.penaltyPaddleCatchCount > prevPenaltyPaddleCatchCount;
          const nowMs = performance.now();

          // NOTE (flagged per the task brief): a bottom-miss penalty reuses
          // the Jolt reaction but is deliberately centered on the BALL'S
          // CURRENT position, not the now-removed orb's position at the
          // bottom of the room -- the orb is gone by the time this reaction
          // fires, so there is nothing meaningful left to center it on there.
          if (rewardHappened || penaltyBallHappened || penaltyBottomMissHappened) {
            // Edge case (deliberately not guarded further): if a reward AND a
            // penalty event both land in the SAME tick (two different orbs),
            // only one reaction visual plays -- reward wins the display, same
            // "one reaction shown at a time" simplification precedent as
            // MB-08's own "at most one drifting-orb contact resolved per
            // substep." The underlying speed/counter effects are NOT
            // affected by this -- both still apply correctly; only which
            // ONE gets a visible reaction this tick is approximate.
            const role: 'reward' | 'penalty' = rewardHappened ? 'reward' : 'penalty';
            driftingOrbReactionRoleRef.current = role;
            driftingOrbReactionUntilRef.current = nowMs + (role === 'reward' ? DRIFTING_ORB_ABSORB_PULSE_DURATION_MS : DRIFTING_ORB_JOLT_FLASH_DURATION_MS);

            if (role === 'reward') {
              const count = getDriftingOrbAbsorbParticleCount(reducedMotionRef.current);
              if (count > 0) {
                particlesRef.current.push(
                  ...createConvergingParticles(next.pong.ball.x, next.pong.ball.y, count, nowMs, DRIFTING_ORB_ABSORB_PARTICLE_ARRIVAL_MS),
                );
              }
            } else {
              const count = getDriftingOrbJoltParticleCount(reducedMotionRef.current);
              if (count > 0) {
                particlesRef.current.push(...createHitParticles(next.pong.ball.x, next.pong.ball.y, count, nowMs));
              }
            }
          }

          // NEW, MB-10: penalty-role paddle-catch -- a successful defensive
          // block, no speed change. A distinct, minimal cue at the PADDLE,
          // not the ball.
          if (paddleCatchHappened) {
            paddleCatchReactionUntilRef.current = nowMs + DRIFTING_ORB_PADDLE_CATCH_PULSE_DURATION_MS;
            const count = getDriftingOrbPaddleCatchParticleCount(reducedMotionRef.current);
            if (count > 0) {
              const currentRoom = roomsRef.current[next.roomIndex - 1];
              if (currentRoom) {
                particlesRef.current.push(...createHitParticles(next.pong.paddleX, currentRoom.engineConfig.paddleY, count, nowMs));
              }
            }
          }

          // NEW, MB-18, ADR-0015 §3 (correction): the 1st-miss "grace"
          // re-serve needs SOME visible distinction from a normal serve, per
          // the task brief -- "don't leave it silent/indistinguishable."
          // Reuses the EXISTING penalty-role Jolt reaction primitive
          // (flash+shake+particles, already drawn at the ball in
          // renderFrame via driftingOrbReactionUntilRef/RoleRef) rather than
          // building a new visual -- a floor miss is negative feedback, the
          // same semantic category Jolt already represents. missCount going
          // from 0 to 1 WITHIN the same room (a room transition/full-restart
          // both reset missCount too, so this diff alone is ambiguous
          // without the same-room guard already established by this whole
          // block) is exactly "the grace path was just taken this tick."
          // Note: on the rare chance a drifting-orb reaction ALSO resolves
          // in this same tick, only one Jolt/Absorb plays -- the same "one
          // reaction shown at a time" simplification already precedented
          // above for a reward/penalty collision, not a new limitation.
          if (next.missCount === 1 && prevMissCount === 0) {
            driftingOrbReactionRoleRef.current = 'penalty';
            driftingOrbReactionUntilRef.current = nowMs + DRIFTING_ORB_JOLT_FLASH_DURATION_MS;
            const count = getDriftingOrbJoltParticleCount(reducedMotionRef.current);
            if (count > 0) {
              particlesRef.current.push(...createHitParticles(next.pong.ball.x, next.pong.ball.y, count, nowMs));
            }
          }
        }

        if (next.roomIndex !== prevRoomIndex) {
          const transitionMs = reducedMotionRef.current ? ROOM_TRANSITION_SECONDS_REDUCED_MOTION * 1000 : ROOM_TRANSITION_SECONDS * 1000;
          transitionUntilRef.current = performance.now() + transitionMs;
        }
        if (next.roomIndex !== lastRoomIndexRef.current) {
          lastRoomIndexRef.current = next.roomIndex;
          onRoomChange(next.roomIndex, next.journeyScore);
        }
        if (next.journeyScore !== prevScore && next.journeyScore !== lastScoreRef.current) {
          lastScoreRef.current = next.journeyScore;
          onScoreChange(next.journeyScore);
        }
        if (next.phase !== lastPhaseRef.current) {
          lastPhaseRef.current = next.phase;
          onPhaseChange(next.phase);
        }
      } catch (error) {
        crash(error);
        return;
      }

      draw();
    },
  });

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      // MB-16: see PongCanvas.tsx's own comment on this same property --
      // identical reasoning applies here. This component is mounted
      // whenever the overlay's phase is 'active' AND sessionType is
      // 'journey', regardless of Journey's OWN internal journeyPhase
      // ('playing' or 'cleared') -- 'cleared' never leaves the overlay's
      // 'active' phase (see roomEngine.ts's JourneyPhase, a sub-state of
      // 'active', not a separate overlay phase), so this element's mount
      // lifecycle already covers both, with no extra phase-gating needed:
      // the paddle stays live (and the cursor stays hidden) through
      // 'cleared' automatically.
      style={{
        // MB-17: these are only the MOUNT-TIME fallback, before the
        // ResizeObserver's first callback (applyBoardSize, above) fires and
        // overwrites canvas.style.width/height imperatively with the exact
        // same pixel numbers driving the drawing buffer -- see that
        // function's own comment for why the canvas's CSS size can no
        // longer be a bare 100%/100% inherited from the parent container.
        width: '100%',
        height: '100%',
        display: 'block',
        // MB-17: the parent container is now `display:flex` (centering this
        // canvas -- see MicroBreakOverlay.tsx's own comment) -- flexShrink:0
        // so the canvas's own explicit pixel size (set imperatively above)
        // is never shrunk by flex layout even by a sub-pixel rounding edge
        // case; it should never need to (the size is already fitted to be
        // <= the container), but this makes that invariant structural rather
        // than incidental.
        flexShrink: 0,
        touchAction: 'none',
        userSelect: 'none',
        cursor: 'none',
      }}
    />
  );
}
