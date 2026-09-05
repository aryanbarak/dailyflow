import { useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { usePullToRefreshRegistry } from './PullToRefreshContext';
import { usePullToRefreshGesture } from './usePullToRefreshGesture';
import { PullToRefreshIndicator } from './PullToRefreshIndicator';
import { PULL_THRESHOLD_PX } from './tuning';

interface MobilePullToRefreshMainProps {
  /** Task 38, point 7: disabled on /chat -- that route manages its own
   *  scroll region and its own state; this component must not touch it.
   *  AppLayout passes its existing `hideMobileChrome` flag straight
   *  through. */
  readonly disabled: boolean;
  readonly bottomPadding: boolean;
}

// Task 38: drop-in replacement for AppLayout's previous inline
// `<main className="flex-1 overflow-auto overscroll-contain ...">` --
// same element, same classes, same <Outlet/> child; the only addition is
// the gesture + indicator wiring. Deliberately does NOT touch the
// `overscroll-contain` on this element (task 37 established it's an
// intentional, unrelated decision from task 17f/20c) -- this is a second,
// independent mechanism layered on top, not a replacement for it.
export function MobilePullToRefreshMain({ disabled, bottomPadding }: MobilePullToRefreshMainProps) {
  const containerRef = useRef<HTMLElement>(null);
  const { hasHandler, triggerRefresh } = usePullToRefreshRegistry();
  const enabled = !disabled && hasHandler;

  const { phase, pullDistance } = usePullToRefreshGesture({
    containerRef,
    enabled,
    onRefresh: triggerRefresh,
  });

  return (
    // PO decision (2026-09-05, phase-5 mobile pass): the bottom nav became
    // icon-only (no labels), so its real height dropped to ~52px -- the
    // reserve shrinks with it (pb-20 -> pb-14).
    <main ref={containerRef} className={cn('flex-1 overflow-auto overscroll-contain', bottomPadding && 'pb-14')}>
      {enabled && phase !== 'idle' && (
        <PullToRefreshIndicator phase={phase} pullDistance={pullDistance} thresholdPx={PULL_THRESHOLD_PX} />
      )}
      <Outlet />
    </main>
  );
}
