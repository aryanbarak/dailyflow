import { useMicroBreaksStore } from '../store/microBreaksStore';
import { MicroBreakOverlay } from './MicroBreakOverlay';

// ADR-0014, MB-02b: auth-free reproduction/smoke harness for the overlay +
// canvas renderer, mirroring the existing /__dev/flow-ai-orb pattern (see
// App.tsx) -- DEV-only route (never registered in a production build),
// outside ProtectedRoute, so Playwright can exercise real canvas 2D
// rendering (unavailable in jsdom -- see MB-02's report) without a
// Supabase-authenticated session.
export function MicroBreaksDevHarness() {
  const startBreak = useMicroBreaksStore(s => s.startBreak);
  const gameActive = useMicroBreaksStore(s => s.gameActive);

  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="mb-4 text-lg font-semibold">Micro Breaks Dev Harness</h1>
      <button
        type="button"
        data-testid="mb-harness-start"
        onClick={() => startBreak()}
        disabled={gameActive}
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
      >
        Start micro break
      </button>
      <MicroBreakOverlay />
    </div>
  );
}
