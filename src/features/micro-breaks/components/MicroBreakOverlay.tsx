import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { isolateBidiRunsInText, resolveMessageBaseDirection } from '@/lib/bidiText';
import { useMicroBreaksStore } from '../store/microBreaksStore';
import { useOrbVisualTokens, type OrbVisualTokens } from '../orbTokens';
import { getLastPointerPosition } from '../pointerPositionRef';
import { DEFAULT_PONG_CONFIG } from '../engine/pongEngine';
import { PongCanvas, type ViewportPoint } from './PongCanvas';

type OverlayPhase = 'idle' | 'active' | 'exiting';

const HANDOFF_TRANSITION_SECONDS = 0.28;
const HANDOFF_EASE = [0.22, 1, 0.36, 1] as const;

function viewportCenter(): ViewportPoint {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Reproduces SmartflowPointerFollower's own DOM structure (see its own
// comment) so the handoff clone is visually identical to both the real
// pointer orb it replaces and the canvas ball it hands off to -- ADR-0014
// §5's "visual parity" acceptance criterion. Deliberately a small local
// duplication rather than extracting a shared component: the ADR is
// explicit that what's shared is the TOKENS, not a component, and
// SmartflowPointerFollower itself must stay untouched/pixel-identical.
function HandoffOrbGlyph({ tokens }: Readonly<{ tokens: OrbVisualTokens }>) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none rounded-full mix-blend-screen"
      style={
        {
          width: tokens.sizePx,
          height: tokens.sizePx,
          opacity: tokens.opacity,
          '--orb-color': tokens.colorVar,
        } as CSSProperties
      }
    >
      <div
        className="absolute inset-0 rounded-full blur-xl"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, hsl(0 0% 100% / 0.5), color-mix(in srgb, var(--orb-color) 34%, transparent) 18%, color-mix(in srgb, var(--orb-color) 12%, transparent) 42%, transparent 70%)',
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70"
        style={{ boxShadow: '0 0 28px color-mix(in srgb, var(--orb-color) 78%, transparent)' }}
      />
      <div
        className="absolute inset-[22%] rounded-full border"
        style={{ borderColor: 'color-mix(in srgb, var(--orb-color) 25%, transparent)' }}
      />
    </div>
  );
}

interface HandoffPoints {
  readonly from: ViewportPoint;
  readonly to: ViewportPoint;
}

// ADR-0014 §3: bespoke overlay (Radix Dialog explicitly NOT used -- see the
// ADR's own rationale). Implements the full dialog-parity checklist itself:
// immediate Esc exit, visible close control, scroll-lock, role="dialog" +
// aria-modal="true" + aria-label, initial focus inside, focus containment,
// focus restoration on close, and complete rAF/listener teardown (the
// canvas -- and therefore its own rAF loop and pointer listeners --
// unmounts the INSTANT close is triggered, before the exit handoff
// animation even starts).
export function MicroBreakOverlay() {
  const gameActive = useMicroBreaksStore(s => s.gameActive);
  const endBreak = useMicroBreaksStore(s => s.endBreak);
  const { t } = useT();
  const tokens = useOrbVisualTokens();
  const reducedMotion = useReducedMotion();

  const config = DEFAULT_PONG_CONFIG;

  const [phase, setPhase] = useState<OverlayPhase>('idle');
  const [handoff, setHandoff] = useState<HandoffPoints | null>(null);
  const [score, setScore] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(config.durationSeconds);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previousOverflowRef = useRef('');
  const viewportBallPositionRef = useRef<ViewportPoint | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Entry: gameActive flips false -> true (an entry point called
  // startBreak()). Captures everything needed to restore the workspace on
  // exit, then kicks off the DOM-orb -> game-start-position handoff.
  useLayoutEffect(() => {
    if (!gameActive || phase !== 'idle') return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    setScore(0);
    setRemainingSeconds(config.durationSeconds);

    const entryPoint = getLastPointerPosition() ?? viewportCenter();
    // The canvas is centered on screen by this component's own layout
    // below, and the ball's engine-space start position is the board
    // center -- so the stage's on-screen center IS the ball's initial
    // viewport position, with no DOM measurement needed.
    setHandoff({ from: entryPoint, to: viewportCenter() });
    setPhase('active');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameActive, phase]);

  // Initial focus, placed inside the overlay the moment it becomes active.
  useEffect(() => {
    if (phase === 'active') closeButtonRef.current?.focus();
  }, [phase]);

  function finalizeClose() {
    document.body.style.overflow = previousOverflowRef.current;
    endBreak();
    previousFocusRef.current?.focus?.();
    setPhase('idle');
    setHandoff(null);
  }

  function handleHandoffComplete() {
    if (phaseRef.current === 'exiting') {
      finalizeClose();
    } else {
      setHandoff(null); // entry handoff finished -- the already-running canvas is the only thing left visible
    }
  }

  function handleClose() {
    if (phaseRef.current !== 'active') return;
    const exitFrom = viewportBallPositionRef.current ?? viewportCenter();
    const exitTo = getLastPointerPosition() ?? exitFrom;
    setHandoff({ from: exitFrom, to: exitTo });
    setPhase('exiting'); // unmounts PongCanvas THIS render -- its own rAF/listener teardown runs immediately, not after the exit animation
  }

  // Esc + focus containment, active for the whole time the dialog is
  // visible (both 'active' and 'exiting' -- exit is quick, but Tab must
  // never leak to the workspace even mid-exit-animation).
  useEffect(() => {
    if (phase === 'idle') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      // el.hidden rather than an offsetParent/layout check: this dialog's
      // controls are never conditionally hidden while still matching
      // FOCUSABLE_SELECTOR, and offsetParent is unreliable in test
      // environments without a real layout engine (jsdom always reports
      // null), so it would silently defeat this filter under test.
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => !el.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1) as HTMLElement;
      const activeIsInside = root.contains(document.activeElement);

      if (event.shiftKey) {
        if (!activeIsInside || document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!activeIsInside || document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [phase]);

  if (phase === 'idle' && !handoff) return null;

  const scoreText = t('micro_breaks_score_value', { score });
  const timeText = t('micro_breaks_time_value', { seconds: Math.max(0, Math.ceil(remainingSeconds)) });

  return (
    <>
      {phase !== 'idle' && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('micro_breaks_overlay_aria_label')}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label={t('micro_breaks_close_aria_label')}
            className="absolute right-4 top-4 rounded-full bg-card/80 p-2 text-foreground shadow-lg transition-colors hover:bg-card"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="absolute left-4 top-4 flex flex-col gap-1 rounded-xl bg-card/80 px-4 py-2 text-sm shadow-lg">
            <span dir={resolveMessageBaseDirection(scoreText)} className="font-medium">
              {isolateBidiRunsInText(scoreText, 'mb-score')}
            </span>
            <span dir={resolveMessageBaseDirection(timeText)} className="text-muted-foreground">
              {isolateBidiRunsInText(timeText, 'mb-time')}
            </span>
          </div>

          {phase === 'active' && (
            <PongCanvas
              config={config}
              onScoreChange={setScore}
              onTimeChange={setRemainingSeconds}
              onGameEnd={handleClose}
              viewportBallPositionRef={viewportBallPositionRef}
            />
          )}
        </div>
      )}

      {handoff && (
        <motion.div
          aria-hidden="true"
          style={{ position: 'fixed', left: 0, top: 0, zIndex: 110 }}
          initial={{ x: handoff.from.x - tokens.sizePx / 2, y: handoff.from.y - tokens.sizePx / 2 }}
          animate={{ x: handoff.to.x - tokens.sizePx / 2, y: handoff.to.y - tokens.sizePx / 2 }}
          transition={reducedMotion ? { duration: 0 } : { duration: HANDOFF_TRANSITION_SECONDS, ease: HANDOFF_EASE }}
          onAnimationComplete={handleHandoffComplete}
        >
          <HandoffOrbGlyph tokens={tokens} />
        </motion.div>
      )}
    </>
  );
}
