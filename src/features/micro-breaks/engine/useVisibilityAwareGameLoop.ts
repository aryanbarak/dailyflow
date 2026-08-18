import { useEffect, useRef } from 'react';

export interface UseVisibilityAwareGameLoopOptions {
  // Whether the loop should be running at all -- false tears the rAF loop
  // and listener down completely (mirrors the pointer-follower's own
  // orbEnabled early-return gate, see smartflow-pointer-follower.tsx).
  readonly active: boolean;
  // Called once per animation frame with that frame's delta in ms. Never
  // called for the very first frame of a run (there is no previous
  // timestamp yet to diff against) -- this is also what makes resume safe.
  readonly onTick: (dtMs: number) => void;
  // Optional: lets a caller pause something ELSE (the game timer) in lockstep
  // with the physics loop, per ADR-0014 §4 ("visibilitychange -> hidden
  // pauses the simulation AND the game timer").
  readonly onVisibilityChange?: (hidden: boolean) => void;
}

// ADR-0014 §4: single rAF loop, dt clamped/substepped downstream in
// pongEngine.stepPong -- this hook's own job is the OTHER half of that
// contract: pausing entirely on visibilitychange -> hidden (no rAF
// scheduled at all while hidden, so onTick simply never fires and neither
// physics nor the timer can advance), and resetting the previous-timestamp
// reference on resume so the first post-resume frame never computes a
// multi-second (or multi-minute) delta from the real wall clock gap.
export function useVisibilityAwareGameLoop({ active, onTick, onVisibilityChange }: UseVisibilityAwareGameLoopOptions): void {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onVisibilityChangeRef = useRef(onVisibilityChange);
  onVisibilityChangeRef.current = onVisibilityChange;

  useEffect(() => {
    if (!active) return;

    let frameId: number | null = null;
    let prevTimestamp: number | null = null;

    const tick = (timestamp: number) => {
      if (prevTimestamp !== null) {
        onTickRef.current(timestamp - prevTimestamp);
      }
      prevTimestamp = timestamp;
      frameId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frameId !== null) return;
      prevTimestamp = null; // resume resets the previous-timestamp reference before integrating
      frameId = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    };

    const handleVisibilityChange = () => {
      const hidden = document.hidden;
      onVisibilityChangeRef.current?.(hidden);
      if (hidden) stop();
      else start();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (!document.hidden) start();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stop();
    };
  }, [active]);
}
