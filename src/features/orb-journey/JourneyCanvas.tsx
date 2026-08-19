import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { useVisibilityAwareGameLoop } from '../micro-breaks/engine/useVisibilityAwareGameLoop';
import { computeBoardConfig, DEFAULT_PONG_CONFIG, rescalePongState, setPaddleX, type PongEngineConfig } from '../micro-breaks/engine/pongEngine';
import { ORB_GRADIENT_STOPS, resolveOrbCanvasColors, useOrbVisualTokens } from '../micro-breaks/orbTokens';
import { setLastPointerPosition } from '../micro-breaks/pointerPositionRef';
import { createHitParticles, type Particle } from '../micro-breaks/particles';
import {
  getParticleCountForMotionPreference,
  PARTICLE_LIFETIME_MS,
  SQUASH_DURATION_MS,
  TRAIL_LENGTH,
  TRAIL_LENGTH_REDUCED_MOTION,
} from '../micro-breaks/tuning';
import type { ViewportPoint } from '../micro-breaks/components/PongCanvas';
import { buildRoomSequence, createInitialJourneyState, stepJourney, type JourneyPhase, type JourneyState, type RoomConfig } from './roomEngine';
import { drawRoomTheme, resolveRoomThemeColors } from './roomTheme';
import { ROOM_TRANSITION_SECONDS, ROOM_TRANSITION_SECONDS_REDUCED_MOTION } from './tuning';

export interface JourneyCanvasProps {
  /** Shared with the parent overlay for the entry handoff's "game start
   *  position" measurement, same pattern as PongCanvas's containerRef --
   *  see that component's own comment. */
  readonly containerRef: RefObject<HTMLDivElement>;
  readonly onRoomChange: (roomIndex: number) => void;
  readonly onScoreChange: (score: number) => void;
  readonly onPhaseChange: (phase: JourneyPhase) => void;
  readonly viewportBallPositionRef?: MutableRefObject<ViewportPoint | null>;
  /** MB-02b/MB-03-FIX pattern, reused unchanged: called at most once if
   *  drawing throws. The overlay shows the SAME 'error' phase and exit path
   *  Quick Break already uses -- Journey does not get its own crash UI. */
  readonly onRenderError: (error: unknown) => void;
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
}: JourneyCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardConfigRef = useRef<PongEngineConfig>(DEFAULT_PONG_CONFIG);
  const roomsRef = useRef<readonly RoomConfig[]>(buildRoomSequence(DEFAULT_PONG_CONFIG));
  const journeyRef = useRef<JourneyState>(createInitialJourneyState(roomsRef.current));
  const trailRef = useRef<ViewportPoint[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastRoomIndexRef = useRef(1);
  const lastScoreRef = useRef(0);
  const lastPhaseRef = useRef<JourneyPhase>('playing');
  const squashUntilRef = useRef(0);
  const transitionUntilRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const crashedRef = useRef(false);
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
    const globalWindow = window as unknown as Record<string, (() => void) | undefined>;
    globalWindow.__orbJourneyDevForceRoomGoal = () => {
      const room = roomsRef.current[journeyRef.current.roomIndex - 1];
      if (!room) return;
      journeyRef.current = { ...journeyRef.current, pong: { ...journeyRef.current.pong, combo: room.goalCombo } };
    };
    return () => {
      delete globalWindow.__orbJourneyDevForceRoomGoal;
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
      const nextBoardConfig = computeBoardConfig(widthPx, heightPx, boardConfigRef.current);
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
  // engineConfig.
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

    const handlePointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      movePaddle(event);
    };
    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      movePaddle(event);
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
    };
  }, []);

  // MB-02b/MB-03-FIX pattern, reused unchanged (see PongCanvas.tsx's own
  // comment): draw() is the ONLY thing allowed to call renderFrame(), and
  // guarantees the exception never escapes uncaught.
  function draw() {
    if (crashedRef.current) return;
    try {
      renderFrame();
    } catch (error) {
      crashedRef.current = true;
      onRenderErrorRef.current(error);
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

    ctx.save();
    ctx.shadowColor = colors.glow(0.8);
    ctx.shadowBlur = reducedMotion ? 0 : 16;
    ctx.fillStyle = colors.core;
    const paddleLeft = state.paddleX - config.paddleWidth / 2;
    ctx.beginPath();
    ctx.roundRect(paddleLeft, config.paddleY, config.paddleWidth, config.paddleHeight, 7);
    ctx.fill();
    ctx.restore();

    const squashing = !reducedMotion && now < squashUntilRef.current;
    const scaleX = squashing ? 1.3 : 1;
    const scaleY = squashing ? 0.7 : 1;

    ctx.save();
    ctx.translate(state.ball.x, state.ball.y);
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
    ctx.restore();

    // ADR-0015 §2/Build 4: short, reduced-motion-aware room-transition
    // flash -- a brief accent-colored wash that fades out, entirely absent
    // under reduced motion (ROOM_TRANSITION_SECONDS_REDUCED_MOTION is 0, so
    // transitionUntilRef is never set ahead of `now` in that case).
    if (!reducedMotion && now < transitionUntilRef.current) {
      const remainingMs = transitionUntilRef.current - now;
      const totalMs = ROOM_TRANSITION_SECONDS * 1000;
      const fadeAlpha = Math.max(0, Math.min(0.35, (remainingMs / totalMs) * 0.35));
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
      const prevRoomIndex = journeyRef.current.roomIndex;
      const prevScore = journeyRef.current.journeyScore;
      const prevPongScore = journeyRef.current.pong.score;
      const next = stepJourney(journeyRef.current, dtMs, roomsRef.current);
      journeyRef.current = next;

      if (next.pong.score !== prevPongScore) {
        squashUntilRef.current = performance.now() + SQUASH_DURATION_MS;
        const particleCount = getParticleCountForMotionPreference(reducedMotionRef.current);
        if (particleCount > 0) {
          particlesRef.current.push(...createHitParticles(next.pong.ball.x, next.pong.ball.y, particleCount, performance.now()));
        }
      }

      if (next.roomIndex !== prevRoomIndex) {
        const transitionMs = reducedMotionRef.current ? ROOM_TRANSITION_SECONDS_REDUCED_MOTION * 1000 : ROOM_TRANSITION_SECONDS * 1000;
        transitionUntilRef.current = performance.now() + transitionMs;
      }
      if (next.roomIndex !== lastRoomIndexRef.current) {
        lastRoomIndexRef.current = next.roomIndex;
        onRoomChange(next.roomIndex);
      }
      if (next.journeyScore !== prevScore && next.journeyScore !== lastScoreRef.current) {
        lastScoreRef.current = next.journeyScore;
        onScoreChange(next.journeyScore);
      }
      if (next.phase !== lastPhaseRef.current) {
        lastPhaseRef.current = next.phase;
        onPhaseChange(next.phase);
      }

      draw();
    },
  });

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        touchAction: 'none',
        userSelect: 'none',
      }}
    />
  );
}
