// @vitest-environment jsdom
//
// MB-20, ADR-0015 §14: the 4th session-end exit path -- the MB-03-FIX
// stuck-exit fail-safe timeout. Mirrors MicroBreakOverlayJourneyExitFailsafe.test.tsx's
// own stuck-animation mock (a NEVER-resolving framer-motion handoff),
// deliberately in its own file since vi.mock('framer-motion', ...) is
// file-scoped and MicroBreakOverlayJourneyPersistence.test.tsx already uses
// a SYNCHRONOUS one for its other 3 exit-path tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MotionDivMock({ children, ...rest }: Record<string, any>) {
    // Deliberately never calls onAnimationComplete -- see
    // MicroBreakOverlayJourneyExitFailsafe.test.tsx's own comment.
    delete rest.initial;
    delete rest.animate;
    delete rest.transition;
    delete rest.onAnimationComplete;
    return React.createElement('div', rest, children);
  }
  return {
    motion: { div: MotionDivMock },
    useReducedMotion: () => false,
  };
});

const getJourneyProgressMock = vi.hoisted(() => vi.fn(async () => null));
const upsertJourneyProgressIfBetterMock = vi.hoisted(() => vi.fn(async () => undefined));
const insertJourneyRunMock = vi.hoisted(() => vi.fn(async () => undefined));

// See MicroBreakOverlayJourneyPersistence.test.tsx's own comment on this
// same mock -- the real client construction throws outside a configured env.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

vi.mock('@/features/orb-journey/journeyPersistenceService', () => ({
  journeyPersistenceService: {
    getJourneyProgress: getJourneyProgressMock,
    upsertJourneyProgressIfBetter: upsertJourneyProgressIfBetterMock,
    insertJourneyRun: insertJourneyRunMock,
  },
}));

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
vi.stubGlobal('localStorage', new MemoryStorage());

const { MicroBreakOverlay } = await import('./MicroBreakOverlay');
const { useMicroBreaksStore } = await import('../store/microBreaksStore');
const { useAppearance } = await import('@/features/settings/appearanceStore');

function resetStore() {
  useMicroBreaksStore.setState({ gameActive: false, mode: 'classic', score: 0 });
  useAppearance.setState({ microBreakDurationSeconds: 90 });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  resetStore();
  getJourneyProgressMock.mockReset().mockResolvedValue(null);
  upsertJourneyProgressIfBetterMock.mockReset().mockResolvedValue(undefined);
  insertJourneyRunMock.mockReset().mockResolvedValue(undefined);
  document.body.style.overflow = '';
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  resetStore();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MicroBreakOverlay Orb Journey persistence: session-end write, path 4/4 -- the stuck-exit fail-safe timeout', () => {
  it('fires the session-end write even when the handoff animation never completes and only the fail-safe timeout tears the overlay down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await vi.waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Orb Journey' }));
    });
    await vi.waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close micro break' }));
    });
    // Animation mock never fires onAnimationComplete -- still stuck 'exiting', same as MicroBreakOverlayJourneyExitFailsafe.test.tsx.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(insertJourneyRunMock).not.toHaveBeenCalled(); // not yet -- proves the write is tied to finalizeClose, not the close click itself

    await act(async () => {
      vi.advanceTimersByTime(2000); // well past HANDOFF_TRANSITION_SECONDS (0.28s) + the 1s safety margin
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(insertJourneyRunMock).toHaveBeenCalledTimes(1); // the fail-safe path itself reached the same session-end write
  });
});
