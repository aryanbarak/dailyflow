import { useEffect, useRef, type MutableRefObject } from 'react';
import { useVisibilityAwareGameLoop } from '../engine/useVisibilityAwareGameLoop';
import {
  createInitialPongState,
  DEFAULT_PONG_CONFIG,
  getRemainingSeconds,
  setPaddleX,
  stepPong,
  type PongEngineConfig,
  type PongState,
} from '../engine/pongEngine';
import { ORB_GRADIENT_STOPS, resolveOrbCanvasColors, useOrbVisualTokens } from '../orbTokens';
import { setLastPointerPosition } from '../pointerPositionRef';

export interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

export interface PongCanvasProps {
  readonly config?: PongEngineConfig;
  readonly onScoreChange: (score: number) => void;
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

const TRAIL_LENGTH = 10;
const TRAIL_LENGTH_REDUCED_MOTION = 3;
const SQUASH_DURATION_MS = 120;

// ADR-0014 §4: single rAF loop (via useVisibilityAwareGameLoop), no
// per-frame React state, no per-frame DOM writes -- physics state lives in
// a ref, and the ONLY per-frame writes are to the canvas itself. Score/time
// only reach the parent's React state when their DISPLAYED value actually
// changes (score on a hit; time once per whole second), never every frame.
export function PongCanvas({
  config = DEFAULT_PONG_CONFIG,
  onScoreChange,
  onTimeChange,
  onGameEnd,
  viewportBallPositionRef,
  onRenderError,
}: PongCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<PongState>(createInitialPongState(config));
  const trailRef = useRef<ViewportPoint[]>([]);
  const lastScoreRef = useRef(0);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = config.width * dpr;
    canvas.height = config.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx?.scale(dpr, dpr);
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.width, config.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toLocalX = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = rect.width === 0 ? 1 : config.width / rect.width;
      return (clientX - rect.left) * ratio;
    };

    const movePaddle = (event: PointerEvent) => {
      setLastPointerPosition(event.clientX, event.clientY);
      stateRef.current = setPaddleX(stateRef.current, toLocalX(event.clientX), config);
    };

    // One path for mouse + touch (Pointer Events), per ADR-0014 §11.
    // preventDefault + the canvas's own touch-action: none (below) stop the
    // underlying page from scrolling/gesturing while playing.
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
  }, [config]);

  // MB-02b: renderFrame() itself may throw (e.g. an unparseable color
  // token reaching a strict-validating canvas API like
  // CanvasGradient.addColorStop -- ctx.fillStyle silently ignores bad
  // values instead, which is why the crash only ever showed up at the
  // gradient stops). draw() is the ONLY thing allowed to call it, and
  // guarantees the exception never escapes uncaught: this is called from a
  // synchronous mount-effect AND from the rAF tick, and an uncaught throw
  // from either one crashes with no local error boundary anywhere in this
  // app's tree (App.tsx has none) -- React unmounts the ENTIRE root, not
  // just this component, which is what actually broke Esc/close in the
  // MB-02b production incident (its own listener effect never got the
  // chance to run). Once crashed, every further call is a no-op forever --
  // this component is about to be unmounted by the overlay's error phase.
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
    const colors = resolveOrbCanvasColors(tokens);
    const reducedMotion = reducedMotionRef.current;

    ctx.clearRect(0, 0, config.width, config.height);

    // Trail (decorative -- shortened under reduced motion, never removed
    // entirely so the ball's motion still reads, per ADR-0014 §11).
    const trail = trailRef.current;
    const maxTrail = reducedMotion ? TRAIL_LENGTH_REDUCED_MOTION : TRAIL_LENGTH;
    trail.push({ x: state.ball.x, y: state.ball.y });
    while (trail.length > maxTrail) trail.shift();
    trail.forEach((point, index) => {
      const alpha = ((index + 1) / trail.length) * 0.25;
      ctx.beginPath();
      ctx.fillStyle = colors.glow(alpha);
      ctx.arc(point.x, point.y, config.ballRadius * 0.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // Paddle, with a soft glow (ADR-0014 §11 game-feel minimum).
    ctx.save();
    ctx.shadowColor = colors.glow(0.8);
    ctx.shadowBlur = reducedMotion ? 0 : 16;
    ctx.fillStyle = colors.core;
    const paddleLeft = state.paddleX - config.paddleWidth / 2;
    ctx.beginPath();
    ctx.roundRect(paddleLeft, config.paddleY, config.paddleWidth, config.paddleHeight, 7);
    ctx.fill();
    ctx.restore();

    // Ball, drawn from the SAME shared orb tokens the DOM pointer-follower
    // uses (orbTokens.ts) -- with an impact squash immediately after a hit.
    const squashing = !reducedMotion && performance.now() < squashUntilRef.current;
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
      const prevScore = stateRef.current.score;
      const next = stepPong(stateRef.current, dtMs, config);
      stateRef.current = next;

      if (next.score !== prevScore) {
        squashUntilRef.current = performance.now() + SQUASH_DURATION_MS;
      }
      if (next.score !== lastScoreRef.current) {
        lastScoreRef.current = next.score;
        onScoreChange(next.score);
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
      style={{
        width: '100%',
        maxWidth: `${config.width}px`,
        height: 'auto',
        aspectRatio: `${config.width} / ${config.height}`,
        touchAction: 'none',
        display: 'block',
      }}
    />
  );
}
