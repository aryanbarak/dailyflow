import { useEffect, useRef, useState, type RefObject } from 'react';
import { GESTURE_DECISION_THRESHOLD_PX, MAX_PULL_PX, PULL_DAMPING_FACTOR, PULL_THRESHOLD_PX } from './tuning';

export type PullToRefreshPhase = 'idle' | 'pulling' | 'ready' | 'refreshing';

export interface UsePullToRefreshGestureOptions {
  readonly containerRef: RefObject<HTMLElement>;
  /** Task 38, point 9: the caller (MobilePullToRefreshMain) only ever sets
   *  this true when a route has actually registered a refresh handler --
   *  see PullToRefreshContext's own comment for the "safe default" this
   *  produces on every other route. */
  readonly enabled: boolean;
  readonly onRefresh: () => Promise<void> | void;
  readonly thresholdPx?: number;
  readonly maxPullPx?: number;
}

export interface UsePullToRefreshGestureResult {
  readonly phase: PullToRefreshPhase;
  readonly pullDistance: number;
}

interface GestureState {
  active: boolean;
  decided: boolean;
  isPull: boolean;
  startX: number;
  startY: number;
}

function createIdleGestureState(): GestureState {
  return { active: false, decided: false, isPull: false, startX: 0, startY: 0 };
}

// Task 38, point 7/10: touch-only gesture on the mobile scroll container.
// Deliberately built on native touchstart/touchmove/touchend listeners
// (added via a ref + addEventListener, not JSX onTouch* props) so
// `preventDefault()` on touchmove is guaranteed to work -- React attaches
// its own touch listeners passively by default, which would silently no-op
// preventDefault() here. Listening to `touch*` events specifically (rather
// than pointer events) is also what makes this touch-only for free: mouse
// and pen input on desktop/pointer devices never dispatch TouchEvents at
// all, so there is nothing to gate separately.
export function usePullToRefreshGesture({
  containerRef,
  enabled,
  onRefresh,
  thresholdPx = PULL_THRESHOLD_PX,
  maxPullPx = MAX_PULL_PX,
}: UsePullToRefreshGestureOptions): UsePullToRefreshGestureResult {
  const [phase, setPhase] = useState<PullToRefreshPhase>('idle');
  const [pullDistance, setPullDistance] = useState(0);

  const phaseRef = useRef<PullToRefreshPhase>('idle');
  phaseRef.current = phase;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return undefined;

    const gesture = createIdleGestureState();

    function reset() {
      Object.assign(gesture, createIdleGestureState());
      setPhase('idle');
      setPullDistance(0);
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) return;
      // ADR-established rule (task 37/38): pull-to-refresh only ever
      // engages when the scroll container is genuinely at its top -- a
      // touch sequence that starts anywhere else is ordinary scrolling and
      // must never be reinterpreted as a pull later in the same sequence.
      if ((container as HTMLElement).scrollTop > 0) {
        gesture.active = false;
        return;
      }
      const touch = event.touches[0];
      gesture.active = true;
      gesture.decided = false;
      gesture.isPull = false;
      gesture.startX = touch.clientX;
      gesture.startY = touch.clientY;
    }

    function handleTouchMove(event: TouchEvent) {
      if (!gesture.active || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - gesture.startX;
      const deltaY = touch.clientY - gesture.startY;

      if (!gesture.decided) {
        if (Math.abs(deltaX) < GESTURE_DECISION_THRESHOLD_PX && Math.abs(deltaY) < GESTURE_DECISION_THRESHOLD_PX) {
          return; // not enough movement yet to tell pull from swipe from scroll
        }
        gesture.decided = true;
        // A horizontal swipe, or an upward flick, is never our gesture --
        // let the browser handle it untouched (no preventDefault below).
        gesture.isPull = deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX);
        if (!gesture.isPull) {
          gesture.active = false;
          return;
        }
      }

      if (!gesture.isPull) return;

      if (deltaY <= 0) {
        // Reversed back past the start mid-gesture -- treat as cancelled,
        // not as "ready" a moment ago.
        reset();
        gesture.active = false;
        return;
      }

      // Only now -- confirmed vertical pull-down from the scroll top -- do
      // we take over the touch sequence from native scrolling.
      event.preventDefault();
      const damped = Math.min(maxPullPx, deltaY * PULL_DAMPING_FACTOR);
      setPullDistance(damped);
      setPhase(damped >= thresholdPx ? 'ready' : 'pulling');
    }

    async function handleTouchEnd() {
      if (!gesture.active || !gesture.isPull) {
        gesture.active = false;
        return;
      }
      gesture.active = false;
      if (phaseRef.current === 'ready') {
        setPhase('refreshing');
        try {
          await onRefreshRef.current();
        } finally {
          reset();
        }
      } else {
        reset();
      }
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
    // Deliberately `containerRef.current` (the actual DOM node), not
    // `containerRef` (the wrapper object) -- a ref object's own identity is
    // conventionally stable, but depending on the object itself rather than
    // the node it holds means any caller who doesn't happen to memoize that
    // wrapper would cause this effect to tear down and reattach (dropping
    // an in-flight gesture, resetting `gesture` to idle mid-pull) on every
    // unrelated re-render. Depending on the node itself only re-attaches
    // when the actual mounted element changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current, enabled, thresholdPx, maxPullPx]);

  // Gesture state must not survive a disable (route navigation away from a
  // page with a registered handler, mid-pull) -- otherwise a stale
  // 'pulling'/'ready' indicator could stick around after the container
  // that owned it is no longer listening.
  useEffect(() => {
    if (!enabled) {
      setPhase('idle');
      setPullDistance(0);
    }
  }, [enabled]);

  return { phase, pullDistance };
}
