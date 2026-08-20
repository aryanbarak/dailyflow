import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { useVisibilityAwareGameLoop } from '../engine/useVisibilityAwareGameLoop';
import {
  computeBoardConfig,
  createInitialPongState,
  DEFAULT_PONG_CONFIG,
  getRemainingSeconds,
  isFinalWave,
  rescalePongState,
  setPaddleX,
  stepPong,
  type PongEngineConfig,
  type PongState,
} from '../engine/pongEngine';
import { ORB_GRADIENT_STOPS, resolveOrbCanvasColors, useOrbVisualTokens } from '../orbTokens';
import { setLastPointerPosition } from '../pointerPositionRef';
import type { MicroBreakDurationSeconds } from '../types';
import { createHitParticles, type Particle } from '../particles';
import {
  FINAL_WAVE_GLOW_BLUR_BOOST,
  FINAL_WAVE_TRAIL_ALPHA_BOOST,
  getParticleCountForMotionPreference,
  PARTICLE_LIFETIME_MS,
  SQUASH_DURATION_MS,
  TRAIL_LENGTH,
  TRAIL_LENGTH_REDUCED_MOTION,
} from '../tuning';

export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface PongCanvasProps {
  readonly durationSeconds?: MicroBreakDurationSeconds;
  /** MB-03: the DOM element PongCanvas measures for responsive sizing
   *  (ResizeObserver) -- owned by the parent overlay, which also measures
   *  it once for the entry handoff's "game start position" (mobile/PWA
   *  acceptance: a REAL getBoundingClientRect() measurement, not Slice 1's
   *  analytical viewport-center assumption, which breaks under
   *  safe-areas/orientation). */
  readonly containerRef: RefObject<HTMLDivElement>;
  readonly onScoreChange: (score: number) => void;
  readonly onComboChange: (combo: number) => void;
  readonly onTimeChange: (remainingSeconds: number) => void;
  readonly onGameEnd: () => void;
  /** Kept updated every tick with the ball's VIEWPORT-space position, so
   *  the overlay can read it synchronously on Esc/close for the exit
   *  handoff (ADR-0014 §5) without this component owning any exit logic. */
  readonly viewportBallPositionRef?: MutableRefObject<ViewportPoint | null>;
  /** MB-02b: called at most once if drawing throws (e.g. an unparseable
   *  color token). The overlay uses this to show a minimal error state and
   *  unmount this component -- normal, controlled teardown, not a crash
   *  that reaches React's reconciler. See draw()'s own comment for why the
   *  guard lives here rather than relying on an app-wide error boundary. */
  readonly onRenderError: (error: unknown) => void;
}

// ADR-0014 §4: single rAF loop (via useVisibilityAwareGameLoop), no
// per-frame React state, no per-frame DOM writes -- physics state lives in
// a ref, and the ONLY per-frame writes are to the canvas itself. Score/time
// only reach the parent's React state when their DISPLAYED value actually
// changes (score/combo on a hit; time once per whole second), never every
// frame.
export function PongCanvas({
  durationSeconds,
  containerRef,
  onScoreChange,
  onComboChange,
  onTimeChange,
  onGameEnd,
  viewportBallPositionRef,
  onRenderError,
}: PongCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initialConfig: PongEngineConfig = durationSeconds ? { ...DEFAULT_PONG_CONFIG, durationSeconds } : DEFAULT_PONG_CONFIG;
  const configRef = useRef<PongEngineConfig>(initialConfig);
  const stateRef = useRef<PongState>(createInitialPongState(initialConfig));
  const trailRef = useRef<ViewportPoint[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastScoreRef = useRef(0);
  const lastComboRef = useRef(0);
  const lastDisplayedSecondRef = useRef(-1);
  const squashUntilRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const crashedRef = useRef(false);
  const onRenderErrorRef = useRef(onRenderError);
  onRenderErrorRef.current = onRenderError;
  const tokens = useOrbVisualTokens();

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // MB-03, mobile/PWA acceptance: re-derives board dimensions from the
  // REAL container size (ResizeObserver) on orientation change / viewport
  // resize, rescaling the running state atomically (rescalePongState) so
  // neither the ball nor the paddle teleports -- see pongEngine.ts's own
  // comments on computeBoardConfig/rescalePongState for the pure logic
  // this wires up. A redundant `orientationchange` listener covers mobile
  // browsers where ResizeObserver historically lags a rotation.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applyBoardSize = (widthPx: number, heightPx: number) => {
      if (widthPx <= 0 || heightPx <= 0) return;
      const nextConfig = computeBoardConfig(widthPx, heightPx, configRef.current);
      const prevConfig = configRef.current;
      if (nextConfig.width === prevConfig.width && nextConfig.height === prevConfig.height) return;

      stateRef.current = rescalePongState(stateRef.current, prevConfig, nextConfig);
      configRef.current = nextConfig;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = nextConfig.width * dpr;
      canvas.height = nextConfig.height * dpr;
      canvas.getContext('2d')?.scale(dpr, dpr);
    };

    const handleOrientationChange = () => {
      const rect = container.getBoundingClientRect();
      applyBoardSize(rect.width, rect.height);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    // MB-02b's own lesson, applied here: never assume a browser API exists
    // (jsdom silently lacking canvas 2D is what let the color-format bug
    // through). ResizeObserver is near-universal today but this effect runs
    // at MOUNT TIME, outside PongCanvas's own draw() guard -- an uncaught
    // throw here would hit the exact same no-error-boundary/whole-app-unmount
    // failure mode MB-02b fixed for rendering. Falls back to one static
    // initial measurement (no live resize) rather than throwing.
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toLocalX = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = rect.width === 0 ? 1 : configRef.current.width / rect.width;
      return (clientX - rect.left) * ratio;
    };

    const movePaddle = (event: PointerEvent) => {
      setLastPointerPosition(event.clientX, event.clientY);
      stateRef.current = setPaddleX(stateRef.current, toLocalX(event.clientX), configRef.current);
    };

    // One path for mouse + touch (Pointer Events), per ADR-0014 §11.
    // preventDefault + the canvas's own touch-action: none (below) stop the
    // underlying page from scrolling/gesturing while playing. Paddle Y
    // never follows the finger (see computeBoardConfig's
    // PADDLE_BOTTOM_MARGIN_RATIO for the "finger rests below the paddle"
    // comfort margin) -- only X does, from wherever on the whole canvas the
    // pointer is, so a finger resting below the paddle still controls it.
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

  // MB-02b: renderFrame() itself may throw (e.g. an unparseable color
  // token reaching a strict-validating canvas API like
  // CanvasGradient.addColorStop -- ctx.fillStyle silently ignores bad
  // values instead, which is why the crash only ever showed up at the
  // gradient stops). draw() is the ONLY thing allowed to call it, and
  // guarantees the exception never escapes uncaught -- see MicroBreakOverlay's
  // 'error' phase for the other half of this guarantee. Once crashed, every
  // further call is a no-op forever -- this component is about to be
  // unmounted by the overlay's error phase.
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
    const state = stateRef.current;
    const config = configRef.current;
    const colors = resolveOrbCanvasColors(tokens);
    const reducedMotion = reducedMotionRef.current;
    const finalWave = isFinalWave(state, config);
    const now = performance.now();

    ctx.clearRect(0, 0, config.width, config.height);

    // Trail (decorative -- shortened under reduced motion, never removed
    // entirely so the ball's motion still reads, per ADR-0014 §11).
    // Brighter during the final wave (visual-only, no score effect --
    // ADR-0014 §12), fully skipped under reduced motion (HUD text is the
    // only final-wave signal there).
    const trail = trailRef.current;
    const maxTrail = reducedMotion ? TRAIL_LENGTH_REDUCED_MOTION : TRAIL_LENGTH;
    trail.push({ x: state.ball.x, y: state.ball.y });
    while (trail.length > maxTrail) trail.shift();
    const trailAlphaBoost = finalWave && !reducedMotion ? FINAL_WAVE_TRAIL_ALPHA_BOOST : 1;
    trail.forEach((point, index) => {
      const alpha = Math.min(1, ((index + 1) / trail.length) * 0.25 * trailAlphaBoost);
      ctx.beginPath();
      ctx.fillStyle = colors.glow(alpha);
      ctx.arc(point.x, point.y, config.ballRadius * 0.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // Particles (Slice 2, bounded polish -- very limited, gone entirely
    // under reduced motion; see getParticleCountForMotionPreference).
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

    // Paddle, with a soft glow (ADR-0014 §11 game-feel minimum), stronger
    // during the final wave.
    const glowBlurBoost = finalWave ? FINAL_WAVE_GLOW_BLUR_BOOST : 1;
    ctx.save();
    ctx.shadowColor = colors.glow(0.8);
    ctx.shadowBlur = reducedMotion ? 0 : 16 * glowBlurBoost;
    ctx.fillStyle = colors.core;
    const paddleLeft = state.paddleX - config.paddleWidth / 2;
    ctx.beginPath();
    ctx.roundRect(paddleLeft, config.paddleY, config.paddleWidth, config.paddleHeight, 7);
    ctx.fill();
    ctx.restore();

    // Ball, drawn from the SAME shared orb tokens the DOM pointer-follower
    // uses (orbTokens.ts) -- with an impact squash immediately after a hit.
    const squashing = !reducedMotion && now < squashUntilRef.current;
    const scaleX = squashing ? 1.3 : 1;
    const scaleY = squashing ? 0.7 : 1;

    ctx.save();
    ctx.translate(state.ball.x, state.ball.y);
    ctx.scale(scaleX, scaleY);

    const glowRadius = config.ballRadius * 2.2 * (finalWave && !reducedMotion ? FINAL_WAVE_GLOW_BLUR_BOOST : 1);
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
      const config = configRef.current;
      const prevScore = stateRef.current.score;
      const prevCombo = stateRef.current.combo;
      const next = stepPong(stateRef.current, dtMs, config);
      stateRef.current = next;

      if (next.score !== prevScore) {
        squashUntilRef.current = performance.now() + SQUASH_DURATION_MS;
        const particleCount = getParticleCountForMotionPreference(reducedMotionRef.current);
        if (particleCount > 0) {
          particlesRef.current.push(...createHitParticles(next.ball.x, next.ball.y, particleCount, performance.now()));
        }
      }
      if (next.score !== lastScoreRef.current) {
        lastScoreRef.current = next.score;
        onScoreChange(next.score);
      }
      if (next.combo !== prevCombo && next.combo !== lastComboRef.current) {
        lastComboRef.current = next.combo;
        onComboChange(next.combo);
      }

      const remaining = getRemainingSeconds(next, config);
      const displayedSecond = Math.ceil(remaining);
      if (displayedSecond !== lastDisplayedSecondRef.current) {
        lastDisplayedSecondRef.current = displayedSecond;
        onTimeChange(remaining);
      }

      draw();

      if (next.status === 'ended') {
        onGameEnd();
      }
    },
  });

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      // MB-16: the paddle IS the visual pointer during gameplay -- the
      // native OS cursor is redundant clutter overlapping/near it. Scoped
      // to this element only (an inline style property never cascades
      // sideways to a sibling like the close button, only down to
      // descendants -- this canvas has none). This component is only ever
      // mounted while the overlay's phase is 'active' (see
      // MicroBreakOverlay.tsx's own render) -- 'choosing' and 'error' never
      // render a <canvas> at all, so there is nothing to gate here: the
      // element's own lifecycle already matches the phases this should
      // apply to. A no-op on touch devices (no native cursor to hide) --
      // does not affect pointermove-driven paddle tracking, which reads
      // event coordinates, not cursor visuals.
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        touchAction: 'none',
        userSelect: 'none',
        cursor: 'none',
      }}
    />
  );
}
