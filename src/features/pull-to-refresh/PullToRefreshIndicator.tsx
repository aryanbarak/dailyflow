import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PullToRefreshPhase } from './usePullToRefreshGesture';

interface PullToRefreshIndicatorProps {
  readonly phase: PullToRefreshPhase;
  readonly pullDistance: number;
  readonly thresholdPx: number;
}

// Rendered as the FIRST child inside the scrolling <main> (not a sibling
// wrapper) so that, at scrollTop 0 (the only time this ever mounts --
// pull-to-refresh only arms there), `sticky top-0` reveals it in normal
// document flow and gently pushes the page content down by its own height,
// with no transforms/absolute positioning needed and no change to <main>'s
// own layout box.
export function PullToRefreshIndicator({ phase, pullDistance, thresholdPx }: PullToRefreshIndicatorProps) {
  const progress = Math.min(1, pullDistance / thresholdPx);
  const height = phase === 'refreshing' ? thresholdPx * 0.6 : pullDistance;

  return (
    <div
      aria-hidden="true"
      className="sticky top-0 z-10 flex items-center justify-center overflow-hidden"
      style={{ height, transition: phase === 'idle' ? 'height 200ms ease' : undefined }}
    >
      <RefreshCw
        className={cn('h-5 w-5 text-muted-foreground', phase === 'refreshing' && 'animate-spin')}
        style={phase === 'refreshing' ? undefined : { transform: `rotate(${progress * 180}deg)`, opacity: progress }}
      />
    </div>
  );
}
