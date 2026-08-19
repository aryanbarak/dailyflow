import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { useT } from '@/i18n';
import { isolateBidiRunsInText, resolveMessageBaseDirection } from '@/lib/bidiText';
import { useAppearance } from '@/features/settings/appearanceStore';
import { JourneyCanvas } from '@/features/orb-journey/JourneyCanvas';
import type { JourneyPhase } from '@/features/orb-journey/roomEngine';
import { useMicroBreaksStore } from '../store/microBreaksStore';
import { useOrbVisualTokens, type OrbVisualTokens } from '../orbTokens';
import { getLastPointerPosition } from '../pointerPositionRef';
import { DEFAULT_MICRO_BREAK_DURATION_SECONDS, resolveMicroBreakDurationSeconds, type MicroBreakDurationSeconds } from '../types';
import { BOARD_ASPECT_RATIO, FINAL_WAVE_WINDOW_SECONDS, HANDOFF_EASE, HANDOFF_TRANSITION_SECONDS } from '../tuning';
import { PongCanvas, type ViewportPoint } from './PongCanvas';

// ADR-0015 §1: two session INTENTS over the one shared engine, not two
// separate products -- 'quick-break' is the existing, unchanged Classic
// Pong; 'journey' is new. Chosen once per open, on the 'choosing' screen.
type SessionType = 'quick-break' | 'journey';

// ADR-0015 §8: 'choosing' is a new phase inserted BEFORE 'active' -- the
// existing entry surfaces (command palette, MobileNav) still just flip
// `gameActive`; this overlay now shows a session-type choice first instead
// of assuming Quick Break. Every phase after 'choosing' behaves exactly as
// it did before this slice for whichever sessionType was picked.
type OverlayPhase = 'idle' | 'choosing' | 'active' | 'exiting' | 'error';

function viewportCenter(): ViewportPoint {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// MB-03, mobile/PWA acceptance: HUD and close control stay clear of
// notches/home indicators. `max(1rem, env(safe-area-inset-*))` -- the
// safe-area function is 0 on devices without one, so this is a no-op
// everywhere else.
const SAFE_AREA_TOP: CSSProperties = { top: 'max(1rem, env(safe-area-inset-top))' };
const SAFE_AREA_RIGHT: CSSProperties = { right: 'max(1rem, env(safe-area-inset-right))' };
const SAFE_AREA_LEFT: CSSProperties = { left: 'max(1rem, env(safe-area-inset-left))' };

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
// animation even starts). Post-MB-02b: the same guarantees hold even if the
// renderer crashes -- see the 'error' phase below and its own comment.
export function MicroBreakOverlay() {
  const gameActive = useMicroBreaksStore(s => s.gameActive);
  const endBreak = useMicroBreaksStore(s => s.endBreak);
  const { t } = useT();
  const tokens = useOrbVisualTokens();
  const reducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<OverlayPhase>('idle');
  const [handoff, setHandoff] = useState<HandoffPoints | null>(null);
  const [sessionType, setSessionType] = useState<SessionType | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(DEFAULT_MICRO_BREAK_DURATION_SECONDS);
  const [activeDurationSeconds, setActiveDurationSeconds] = useState<MicroBreakDurationSeconds>(DEFAULT_MICRO_BREAK_DURATION_SECONDS);
  // ADR-0015 §6: Journey's own running state -- room number, cumulative
  // score, and the 'cleared' acknowledgement (see roomEngine.ts's own
  // comment on JourneyPhase). Deliberately separate state from Quick
  // Break's score/remainingSeconds above, never read by that session type.
  const [journeyRoom, setJourneyRoom] = useState(1);
  const [journeyScore, setJourneyScore] = useState(0);
  const [journeyPhase, setJourneyPhase] = useState<JourneyPhase>('playing');

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previousOverflowRef = useRef('');
  const entryPointRef = useRef<ViewportPoint>({ x: 0, y: 0 });
  const viewportBallPositionRef = useRef<ViewportPoint | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Entry: gameActive flips false -> true (an entry point called
  // startBreak()). Captures everything needed to restore the workspace on
  // exit and shows the session-type choice screen (ADR-0015 §8) -- neither
  // session type's own state is touched yet, only whichever one the user
  // picks gets initialized (see handleChooseQuickBreak/handleChooseJourney
  // below). The handoff's measured target point is set by the SEPARATE
  // layout effect below, once the game stage exists to measure (i.e. once
  // phase reaches 'active', after a choice is made).
  useLayoutEffect(() => {
    if (!gameActive || phase !== 'idle') return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    entryPointRef.current = getLastPointerPosition() ?? viewportCenter();
    setPhase('choosing');
  }, [gameActive, phase]);

  // ADR-0015 §8: "New Journey" only this slice (no persistence, so
  // "Continue Journey" is not yet meaningful -- ADR-0015 §9).
  function handleChooseQuickBreak() {
    const preset = resolveMicroBreakDurationSeconds(useAppearance.getState().microBreakDurationSeconds);
    setActiveDurationSeconds(preset);
    setScore(0);
    setCombo(0);
    setRemainingSeconds(preset);
    setSessionType('quick-break');
    setPhase('active');
  }

  function handleChooseJourney() {
    setJourneyRoom(1);
    setJourneyScore(0);
    setJourneyPhase('playing');
    setSessionType('journey');
    setPhase('active');
  }

  // MB-03, mobile/PWA acceptance: the entry handoff's "game start position"
  // is now a REAL getBoundingClientRect() measurement of the stage that's
  // about to hold the canvas -- Slice 1's `viewportCenter()` assumption for
  // this point broke under safe-areas/orientation (the stage is not always
  // exactly screen-center once safe-area padding is applied). Runs as a
  // separate layout effect (after the stage above has mounted and has real
  // geometry), both still before paint, so there is no visible flash
  // between the stage appearing and the handoff orb starting its animation
  // from the right target.
  useLayoutEffect(() => {
    if (phase !== 'active' || handoff) return;
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    const to = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : viewportCenter();
    setHandoff({ from: entryPointRef.current, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Initial focus, placed inside the overlay the moment it becomes active
  // OR reaches the choice screen (ADR-0015 §8: the choice screen is still
  // part of the same dialog, focus must land inside it immediately too).
  useEffect(() => {
    if (phase === 'active' || phase === 'choosing') closeButtonRef.current?.focus();
  }, [phase]);

  function finalizeClose() {
    document.body.style.overflow = previousOverflowRef.current;
    endBreak();
    previousFocusRef.current?.focus?.();
    setPhase('idle');
    setHandoff(null);
    setSessionType(null);
    setJourneyRoom(1);
    setJourneyScore(0);
    setJourneyPhase('playing');
  }

  function handleHandoffComplete() {
    if (phaseRef.current === 'exiting') {
      finalizeClose();
    } else {
      setHandoff(null); // entry handoff finished -- the already-running canvas is the only thing left visible
    }
  }

  // MB-03-FIX: the ONLY normal path to finalizeClose() during exit is
  // motion.div's onAnimationComplete, above. If that callback never fires --
  // a backgrounded tab suspends the animation's rAF mid-flight, a
  // framer-motion edge case, or any other page-visibility hiccup while the
  // ~280ms exit transition is in progress -- `phase` stays 'exiting'
  // indefinitely. The dialog root's gesture guards (below) are scoped to
  // 'active' only, but a stuck 'exiting' state still leaves a
  // position:fixed, full-viewport dialog mounted with document.body.style.
  // overflow left 'hidden' forever, which reads to a user as "scrolling and
  // pull-to-refresh are broken everywhere" with no way to escape (they can't
  // even pull-to-refresh to reload). This mirrors ADR-0014 §3's post-MB-02b
  // invariant -- exit must not depend on something else (there, the
  // renderer; here, the exit animation) completing successfully. Generous
  // margin over HANDOFF_TRANSITION_SECONDS so it never races the normal
  // path on a healthy device.
  useEffect(() => {
    if (phase !== 'exiting') return;
    const timeoutId = window.setTimeout(
      () => {
        if (phaseRef.current === 'exiting') finalizeClose();
      },
      (HANDOFF_TRANSITION_SECONDS + 1) * 1000,
    );
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleClose() {
    // MB-02b: closable from 'error' too -- Esc/close must work even if the
    // renderer crashed. viewportBallPositionRef.current is already null
    // (or stale-but-harmless) in that case; the viewportCenter() fallback
    // covers it the same way it covers a close fired before the first tick.
    // ADR-0015 §8: also closable from 'choosing' -- the choice screen is
    // still part of the dialog, ADR-0014 §3's "immediate Esc exit" applies
    // to the whole dialog, not just active gameplay. No ball position
    // exists yet there either, same viewportCenter() fallback covers it.
    if (phaseRef.current !== 'active' && phaseRef.current !== 'error' && phaseRef.current !== 'choosing') return;
    const exitFrom = viewportBallPositionRef.current ?? viewportCenter();
    const exitTo = getLastPointerPosition() ?? exitFrom;
    setHandoff({ from: exitFrom, to: exitTo });
    setPhase('exiting'); // unmounts PongCanvas THIS render -- its own rAF/listener teardown runs immediately, not after the exit animation
  }

  // MB-02b: draw() (PongCanvas) guarantees this is called at most once and
  // never lets the original exception escape uncaught -- see PongCanvas's
  // own comment for why an uncaught throw here would otherwise take down
  // the ENTIRE app (no error boundary exists anywhere in App.tsx). Teardown
  // (rAF/listeners) already happened via PongCanvas unmounting the instant
  // `phase` flips away from 'active' below -- this is a normal, controlled
  // React state transition, not a crash reaching the reconciler.
  function handleRenderError(error: unknown) {
    console.error('[micro-breaks] game rendering failed, showing fallback state', error);
    setPhase('error');
  }

  // Esc + focus containment, active for the whole time the dialog is
  // visible ('active', 'exiting', and 'error' -- Tab must never leak to the
  // workspace in any of them).
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
  const comboText = t('micro_breaks_combo_value', { combo });
  const finalWaveText = t('micro_breaks_final_wave_label');
  const showFinalWave = phase === 'active' && sessionType === 'quick-break' && remainingSeconds <= FINAL_WAVE_WINDOW_SECONDS;

  const journeyScoreText = t('micro_breaks_score_value', { score: journeyScore });
  const journeyRoomText = t('micro_breaks_journey_room_value', { room: journeyRoom });
  const journeyClearedText = t('micro_breaks_journey_cleared_label');

  // ADR-0015 §8: the choice screen is still "a micro break" generically;
  // once a session type is picked, its own specific label takes over.
  const dialogAriaLabel =
    phase === 'active' && sessionType === 'journey'
      ? t('micro_breaks_journey_overlay_aria_label')
      : phase === 'active' && sessionType === 'quick-break'
        ? t('micro_breaks_overlay_aria_label')
        : t('micro_breaks_entry_label');

  return (
    <>
      {phase !== 'idle' && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={dialogAriaLabel}
          className="fixed inset-0 z-[100] flex select-none items-center justify-center bg-black/50 backdrop-blur-sm"
          // MB-03-FIX: scoped to 'active' only (not 'exiting'/'error' too) --
          // gameplay is the only phase where blocking scroll/pull-to-refresh
          // is actually needed. Narrowing this window means even a stuck
          // 'exiting' phase (see the fail-safe timeout above) can no longer
          // leave a gesture block in place -- see this file's own report for
          // the MB-03-FIX root-cause writeup.
          style={{
            overscrollBehavior: phase === 'active' ? 'contain' : undefined,
            touchAction: phase === 'active' ? 'none' : undefined,
          }}
          onContextMenu={event => event.preventDefault()}
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label={t('micro_breaks_close_aria_label')}
            className="absolute z-10 rounded-full bg-card/80 p-2 text-foreground shadow-lg transition-colors hover:bg-card"
            style={{ ...SAFE_AREA_TOP, ...SAFE_AREA_RIGHT }}
          >
            <X className="h-5 w-5" />
          </button>

          {phase === 'choosing' && (
            <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-xl bg-card px-6 py-8 text-center shadow-lg">
              <p dir={resolveMessageBaseDirection(t('micro_breaks_session_choice_title'))} className="text-sm font-medium text-muted-foreground">
                {isolateBidiRunsInText(t('micro_breaks_session_choice_title'), 'mb-choice-title')}
              </p>
              <button
                type="button"
                onClick={handleChooseQuickBreak}
                aria-label={t('micro_breaks_session_choice_quick_break')}
                aria-describedby="mb-choice-quick-break-desc"
                className="flex w-full flex-col gap-0.5 rounded-lg bg-secondary/60 px-4 py-3 text-left transition-colors hover:bg-secondary"
              >
                <span className="font-medium" aria-hidden="true">
                  {t('micro_breaks_session_choice_quick_break')}
                </span>
                <span id="mb-choice-quick-break-desc" className="text-xs text-muted-foreground">
                  {t('micro_breaks_session_choice_quick_break_desc')}
                </span>
              </button>
              <button
                type="button"
                onClick={handleChooseJourney}
                aria-label={t('micro_breaks_session_choice_journey')}
                aria-describedby="mb-choice-journey-desc"
                className="flex w-full flex-col gap-0.5 rounded-lg bg-secondary/60 px-4 py-3 text-left transition-colors hover:bg-secondary"
              >
                <span className="font-medium" aria-hidden="true">
                  {t('micro_breaks_session_choice_journey')}
                </span>
                <span id="mb-choice-journey-desc" className="text-xs text-muted-foreground">
                  {t('micro_breaks_session_choice_journey_desc')}
                </span>
              </button>
            </div>
          )}

          {phase === 'active' && sessionType === 'quick-break' && (
            <div
              className="absolute z-10 flex flex-col gap-1 rounded-xl bg-card/80 px-4 py-2 text-sm shadow-lg"
              style={{ ...SAFE_AREA_TOP, ...SAFE_AREA_LEFT }}
            >
              <span dir={resolveMessageBaseDirection(scoreText)} className="font-medium">
                {isolateBidiRunsInText(scoreText, 'mb-score')}
              </span>
              <span dir={resolveMessageBaseDirection(timeText)} className="text-muted-foreground">
                {isolateBidiRunsInText(timeText, 'mb-time')}
              </span>
              {combo >= 2 && (
                <span dir={resolveMessageBaseDirection(comboText)} className="font-medium text-primary">
                  {isolateBidiRunsInText(comboText, 'mb-combo')}
                </span>
              )}
              {showFinalWave && (
                <span dir={resolveMessageBaseDirection(finalWaveText)} className="font-medium text-destructive">
                  {isolateBidiRunsInText(finalWaveText, 'mb-final-wave')}
                </span>
              )}
            </div>
          )}

          {/* ADR-0015 §6: room number + running score, deliberately NO timer
              display -- the key visual difference from Quick Break's
              countdown, since Journey is untimed. */}
          {phase === 'active' && sessionType === 'journey' && (
            <div
              className="absolute z-10 flex flex-col gap-1 rounded-xl bg-card/80 px-4 py-2 text-sm shadow-lg"
              style={{ ...SAFE_AREA_TOP, ...SAFE_AREA_LEFT }}
            >
              <span dir={resolveMessageBaseDirection(journeyRoomText)} className="font-medium">
                {isolateBidiRunsInText(journeyRoomText, 'mb-journey-room')}
              </span>
              <span dir={resolveMessageBaseDirection(journeyScoreText)} className="text-muted-foreground">
                {isolateBidiRunsInText(journeyScoreText, 'mb-journey-score')}
              </span>
              {journeyPhase === 'cleared' && (
                <span dir={resolveMessageBaseDirection(journeyClearedText)} className="font-medium text-primary">
                  {isolateBidiRunsInText(journeyClearedText, 'mb-journey-cleared')}
                </span>
              )}
            </div>
          )}

          {phase === 'active' && sessionType === 'quick-break' && (
            <div
              ref={canvasContainerRef}
              className="relative mx-auto w-full max-w-[480px]"
              style={{ aspectRatio: String(BOARD_ASPECT_RATIO), maxHeight: 'min(70vh, 720px)' }}
            >
              <PongCanvas
                durationSeconds={activeDurationSeconds}
                containerRef={canvasContainerRef}
                onScoreChange={setScore}
                onComboChange={setCombo}
                onTimeChange={setRemainingSeconds}
                onGameEnd={handleClose}
                viewportBallPositionRef={viewportBallPositionRef}
                onRenderError={handleRenderError}
              />
            </div>
          )}

          {phase === 'active' && sessionType === 'journey' && (
            <div
              ref={canvasContainerRef}
              className="relative mx-auto w-full max-w-[480px]"
              style={{ aspectRatio: String(BOARD_ASPECT_RATIO), maxHeight: 'min(70vh, 720px)' }}
            >
              <JourneyCanvas
                containerRef={canvasContainerRef}
                onRoomChange={setJourneyRoom}
                onScoreChange={setJourneyScore}
                onPhaseChange={setJourneyPhase}
                viewportBallPositionRef={viewportBallPositionRef}
                onRenderError={handleRenderError}
              />
            </div>
          )}

          {phase === 'error' && (
            <div className="flex max-w-xs flex-col items-center gap-3 rounded-xl bg-card px-6 py-8 text-center shadow-lg">
              <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
              <p dir={resolveMessageBaseDirection(t('micro_breaks_render_error'))}>
                {isolateBidiRunsInText(t('micro_breaks_render_error'), 'mb-render-error')}
              </p>
            </div>
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
