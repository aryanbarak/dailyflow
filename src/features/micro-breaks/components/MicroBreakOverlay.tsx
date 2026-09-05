import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { useT } from '@/i18n';
import { createId } from '@/lib/id';
import { isolateBidiRunsInText, resolveMessageBaseDirection } from '@/lib/bidiText';
import { cn } from '@/lib/utils';
import { useAppearance } from '@/features/settings/appearanceStore';
import { supabase } from '@/integrations/supabase/client';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { JourneyCanvas } from '@/features/orb-journey/JourneyCanvas';
import type { JourneyPhase } from '@/features/orb-journey/roomEngine';
import type { JourneyProgressCandidate, JourneyRunSummary } from '@/features/orb-journey/journeyPersistenceService';
import { flushJourneyPersistenceQueue } from '@/features/orb-journey/journeyPersistenceQueue';
import { loadJourneyProgressOnce, maybeRecordRoomCompletion, recordJourneySessionEnd, useJourneyProgressCache } from '@/features/orb-journey/journeyPersistenceRuntime';
import { JOURNEY_PLAY_AREA_MAX_WIDTH_PX } from '@/features/orb-journey/tuning';
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
      // DESIGN-AUDIT 0.6 follow-up (2026-09-05): mirrors the follower's
      // light-theme fix (multiply on light, screen on dark) so the
      // handoff clone stays visually identical in both themes.
      className="pointer-events-none rounded-full mix-blend-multiply dark:mix-blend-screen"
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
        className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--orb-color)_55%,transparent)] dark:bg-white/70"
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
  // MB-20, ADR-0015 §14: which room a Journey session's physics actually
  // START at -- 1 for "New Journey", the stored farthest_room for "Continue
  // Journey" (see handleContinueJourney below). Deliberately separate from
  // `journeyRoom` (the CURRENT room, which changes throughout play): this is
  // fixed once per session, at choice time, and only ever read by
  // JourneyCanvas's own mount-time initial state.
  const [journeyStartRoomIndex, setJourneyStartRoomIndex] = useState(1);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previousOverflowRef = useRef('');
  const entryPointRef = useRef<ViewportPoint>({ x: 0, y: 0 });
  const viewportBallPositionRef = useRef<ViewportPoint | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // MB-20, ADR-0015 §14: the client-generated run id (createId() -- a UUID
  // in secure contexts, with a non-crashing fallback elsewhere),
  // set ONCE at session start (handleChooseJourney/handleContinueJourney) --
  // NOT at session end -- so a retry after a mid-session write failure (the
  // localStorage queue's next flush) reuses the SAME id, matching
  // journeyPersistenceService's own on-conflict-do-nothing idempotency
  // contract (MB-19). null whenever no Journey session is currently open
  // (Quick Break sessions never touch this at all).
  const journeyRunIdRef = useRef<string | null>(null);
  const journeyProgressSnapshot = useJourneyProgressCache(s => s.snapshot);
  const { isOnline } = useNetworkStatus();
  const wasOnlineRef = useRef(isOnline);

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
    journeyRunIdRef.current = createId();
    setJourneyRoom(1);
    setJourneyStartRoomIndex(1);
    setJourneyScore(0);
    setJourneyPhase('playing');
    setSessionType('journey');
    setPhase('active');
  }

  // MB-20, ADR-0015 §14: "Continue Journey" -- starts at the FIRST sub-state
  // of the stored farthest_room, never mid-room physics state. Falls back to
  // room 1 if the snapshot is somehow unavailable at click time (the button
  // itself is only rendered when a snapshot exists -- see the 'choosing'
  // phase JSX below -- so this fallback is a defensive default, not an
  // expected path).
  function handleContinueJourney() {
    const startRoom = journeyProgressSnapshot?.farthestRoom ?? 1;
    // MB-23, ADR-0015 §14 (extended): restore the score you had at this
    // checkpoint, not 0 -- checkpointScore is only meaningful when a
    // snapshot exists (this button only renders once one does; see the
    // 'choosing' phase JSX), so the ?? 0 fallback below is defensive only.
    const startScore = journeyProgressSnapshot?.checkpointScore ?? 0;
    journeyRunIdRef.current = createId();
    setJourneyRoom(startRoom);
    setJourneyStartRoomIndex(startRoom);
    setJourneyScore(startScore);
    setJourneyPhase('playing');
    setSessionType('journey');
    setPhase('active');
  }

  // MB-20, ADR-0015 §14: a lightweight, non-blocking read of the user's
  // checkpoint -- fired once the picker is reachable ('choosing' phase,
  // which every open reaches immediately regardless of which session type
  // is eventually picked, or none at all). loadJourneyProgressOnce is
  // itself idempotent per app session (see its own comment), so re-opening
  // the picker multiple times never re-fires the network read. Deliberately
  // NOT awaited/blocking: the picker renders immediately either way (see
  // the 'choosing' phase JSX, which only shows "Continue Journey" once
  // journeyProgressSnapshot resolves to a non-null value).
  useEffect(() => {
    if (phase !== 'choosing') return;
    loadJourneyProgressOnce(supabase);
  }, [phase]);

  // MB-20, ADR-0015 §14: "retried on next app load or the next online
  // event" -- one flush on mount (app load), reusing useNetworkStatus's
  // existing online/offline signal (not polling navigator.onLine) for the
  // second trigger. Both calls are non-blocking (flushJourneyPersistenceQueue
  // returns a Promise this effect never awaits).
  useEffect(() => {
    flushJourneyPersistenceQueue(supabase);
  }, []);
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) flushJourneyPersistenceQueue(supabase);
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  // MB-20, ADR-0015 §14 (Step 1): fires wherever JourneyCanvas reports a room
  // transition -- the exact "room N completed, advancing to N+1" signal the
  // task brief points to (see JourneyCanvas.tsx's own onTick, which only
  // calls onRoomChange when next.roomIndex actually changes). Guarded to
  // 'journey' sessions only; Quick Break never calls this handler at all (a
  // separate prop). Never awaited -- maybeRecordRoomCompletion is itself
  // fire-and-forget (see its own comment), so this stays synchronous too.
  function handleJourneyRoomChange(roomIndex: number, score: number) {
    setJourneyRoom(roomIndex);
    if (sessionType === 'journey') maybeRecordRoomCompletion(supabase, roomIndex, score);
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

  // MB-20, ADR-0015 §14 (Step 2): this is the SINGLE funnel every Journey
  // exit path reaches -- close-button click and Esc both go through
  // handleClose -> phase 'exiting' -> here (via the handoff animation's
  // onAnimationComplete, OR the MB-03-FIX stuck-exit fail-safe timeout if
  // that animation never fires); a render crash (MB-11/MB-12's 'error'
  // phase) still reaches handleClose (see its own comment: "closable from
  // 'error' too"), so it funnels here identically. Firing the session-end
  // write HERE, once, rather than duplicating it at each trigger site, is
  // exactly what makes it impossible to reproduce this feature's own past
  // "one exit path forgotten" bug class (MB-03-FIX/MB-11/MB-12) for this
  // specific write.
  function finalizeClose() {
    if (sessionType === 'journey' && journeyRunIdRef.current) {
      const run: JourneyRunSummary = { id: journeyRunIdRef.current, endedAtRoom: journeyRoom, totalScore: journeyScore };
      // roomsDiscoveredCount = journeyRoom (the same value as farthestRoom
      // here) -- a judgment call, flagged per the task brief's own "flag if
      // you have to guess" instruction: Orb Journey's room sequence is
      // strictly linear (roomEngine.ts's stepJourney only ever advances
      // roomIndex by exactly 1, never skips), so "every room up to and
      // including the current one has been visited" is a structural fact
      // of this run, not a guess -- reaching room N means rooms 1..N were
      // all discovered. maybeRecordRoomCompletion (journeyPersistenceRuntime.ts)
      // makes the same choice for its own candidate, for the same reason.
      const progressCandidate: JourneyProgressCandidate = {
        farthestRoom: journeyRoom,
        bestTotalScore: journeyScore,
        roomsDiscoveredCount: journeyRoom,
        // MB-23: mirrors maybeRecordRoomCompletion's own candidate -- if this
        // session-end write is ALSO the moment farthest_room improves (e.g.
        // Esc pressed exactly on a fresh room), checkpoint_score should be
        // this run's live score, not left stale.
        checkpointScore: journeyScore,
      };
      recordJourneySessionEnd(supabase, run, progressCandidate);
    }
    journeyRunIdRef.current = null;
    document.body.style.overflow = previousOverflowRef.current;
    endBreak();
    previousFocusRef.current?.focus?.();
    setPhase('idle');
    setHandoff(null);
    setSessionType(null);
    setJourneyRoom(1);
    setJourneyScore(0);
    setJourneyPhase('playing');
    setJourneyStartRoomIndex(1);
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

  // MB-20, ADR-0015 §14: "if journey_progress exists for the user, the
  // session-type picker offers 'Continue Journey'... alongside 'New
  // Journey'." journeyProgressSnapshot is undefined until the read resolves
  // (or never, if it's still in flight/offline) -- the picker itself never
  // waits for it (see the loadJourneyProgressOnce effect's own comment); the
  // button below simply appears once/if it does.
  const continueJourneyText = journeyProgressSnapshot
    ? t('micro_breaks_session_choice_continue_journey', { room: journeyProgressSnapshot.farthestRoom })
    : '';

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
          // MB-17, ADR-0014 §2 (correction): the uniform full-viewport dim/
          // blur wash stays exactly as-is for Quick Break, 'choosing', and
          // 'error' -- but is SUPPRESSED here for Journey's own 'active'
          // phase, where a separate, width-scoped dim/blur band (rendered
          // below, bound to the SAME journeyMaxWidthPx driving the canvas
          // container) takes over instead. See that element's own comment
          // for why it can't just reuse this root's uniform treatment.
          className={cn(
            'fixed inset-0 z-[100] flex select-none items-center justify-center',
            !(phase === 'active' && sessionType === 'journey') && 'bg-black/50 backdrop-blur-sm',
          )}
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
              {/* MB-20, ADR-0015 §14: only rendered once/if journeyProgressSnapshot
                  resolves to a real checkpoint -- absent entirely for a
                  first-time player, and absent (not a loading spinner) while
                  the read is still in flight, per the task brief's own
                  "render immediately... add Continue once/if it resolves"
                  instruction. Deliberately placed FIRST (above Quick Break/
                  Orb Journey) -- a returning player's most likely next
                  action. */}
              {journeyProgressSnapshot && (
                <button
                  type="button"
                  onClick={handleContinueJourney}
                  aria-label={continueJourneyText}
                  aria-describedby="mb-choice-continue-desc"
                  className="flex w-full flex-col gap-0.5 rounded-lg bg-secondary/60 px-4 py-3 text-left transition-colors hover:bg-secondary"
                >
                  <span dir={resolveMessageBaseDirection(continueJourneyText)} className="font-medium" aria-hidden="true">
                    {isolateBidiRunsInText(continueJourneyText, 'mb-choice-continue')}
                  </span>
                  <span id="mb-choice-continue-desc" className="text-xs text-muted-foreground">
                    {t('micro_breaks_session_choice_continue_journey_desc')}
                  </span>
                </button>
              )}
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

          {/* MB-17, ADR-0014 §2 (correction); MB-22: the dim/blur boundary
              itself -- a SEPARATE element from the canvas container below,
              deliberately FULL HEIGHT (not aspect-ratio/maxHeight-bound like
              the gameplay-comfort-driven canvas container) and width-capped
              by the SAME JOURNEY_PLAY_AREA_MAX_WIDTH_PX constant the
              container's own max-width uses -- reused directly, not a
              second computation. MB-22 retired the per-room growth this
              boundary used to track (ADR-0015 §13) -- now a fixed width,
              no CSS transition (nothing to animate between rooms anymore).
              Full height (not the canvas container's own up-to-70vh/720px-
              capped height) is what makes this converge with Quick Break's
              own always-full-viewport dim/blur once the fixed width exceeds
              the viewport (mobile) -- if this instead reused the canvas
              container's OWN (height-capped) box, the top/bottom strips of
              the viewport would stay permanently undimmed. Rendered BEHIND
              the canvas container (earlier in DOM order, so it paints first
              / below) -- `pointer-events-none` so it never intercepts
              paddle input in the rare case its box is wider than the
              actually-rendered canvas (see JourneyCanvas.tsx's own comment
              on why the canvas can be narrower than this boundary once the
              height cap binds). */}
          {phase === 'active' && sessionType === 'journey' && (
            <div
              aria-hidden="true"
              data-testid="journey-play-area-boundary"
              className="pointer-events-none absolute inset-0 mx-auto w-full bg-black/50 backdrop-blur-sm"
              style={{ maxWidth: `${JOURNEY_PLAY_AREA_MAX_WIDTH_PX}px` }}
            />
          )}

          {phase === 'active' && sessionType === 'journey' && (
            <div
              ref={canvasContainerRef}
              className="relative mx-auto flex w-full items-center justify-center"
              // MB-22, ADR-0015 §13 (retirement): max-width is now the fixed
              // JOURNEY_PLAY_AREA_MAX_WIDTH_PX constant (500px), identical
              // for every room -- no more room-index-derived growth, no CSS
              // transition (there is nothing left to animate between
              // rooms). Quick Break's OWN container (above) still uses its
              // unrelated fixed `max-w-[480px]` Tailwind class, untouched.
              // `w-full` is preserved, so on any viewport narrower than
              // JOURNEY_PLAY_AREA_MAX_WIDTH_PX (most phones), 100% still
              // wins, same mobile composition as before.
              //
              // MB-17: `flex items-center justify-center` -- the canvas
              // inside is not guaranteed to exactly fill this box
              // (JourneyCanvas.tsx pins the canvas's own CSS size to its
              // correctly-2:3-fitted computeBoardConfig output, which can be
              // NARROWER than this container's own box once `maxHeight:
              // min(70vh, 720px)` binds tighter than `maxWidth:
              // JOURNEY_PLAY_AREA_MAX_WIDTH_PX` implies -- a real,
              // empirically-confirmed CSS aspect-ratio/max-height
              // interaction, see the MB-17 report). Centering here keeps the
              // canvas visually centered within whatever box this container
              // ends up being, instead of pinned to its top-left corner.
              style={{
                aspectRatio: String(BOARD_ASPECT_RATIO),
                maxHeight: 'min(70vh, 720px)',
                maxWidth: `${JOURNEY_PLAY_AREA_MAX_WIDTH_PX}px`,
              }}
            >
              {/* ADR-0015 §6: room number + running score, deliberately NO
                  timer display -- the key visual difference from Quick
                  Break's countdown, since Journey is untimed.
                  MB-22, ADR-0014 §2 (updated): relocated from the overlay's
                  own top-left corner (a sibling of this container, anchored
                  to the FULL VIEWPORT via SAFE_AREA_TOP/LEFT) to HERE --
                  MB-17 correctly cleared everything outside the play-area
                  boundary above, which left this HUD (previously outside
                  it) sitting on full-brightness dashboard content once that
                  fix shipped. Positioned `absolute` against THIS container
                  (which has `position: relative`, so SAFE_AREA_TOP/LEFT now
                  resolve to ITS top-left corner, not the viewport's) --
                  same box the dim/blur boundary above is sized to, so the
                  HUD sits on the dim backdrop as originally intended. z-10
                  keeps it above the canvas (a sibling later in this same
                  stacking context); not aria-hidden (the boundary div above
                  is decorative-only and correctly aria-hidden, but this HUD
                  carries real room/score information a screen reader user
                  needs, so it must NOT inherit that treatment by being
                  nested inside the boundary element -- kept as its own,
                  separate, non-hidden node instead). */}
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
              <JourneyCanvas
                containerRef={canvasContainerRef}
                onRoomChange={handleJourneyRoomChange}
                onScoreChange={setJourneyScore}
                onPhaseChange={setJourneyPhase}
                viewportBallPositionRef={viewportBallPositionRef}
                onRenderError={handleRenderError}
                startRoomIndex={journeyStartRoomIndex}
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
