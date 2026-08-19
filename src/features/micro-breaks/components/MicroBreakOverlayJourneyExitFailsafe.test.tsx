// @vitest-environment jsdom
//
// MB-05: re-verifies the MB-03-FIX exit fail-safe (see
// MicroBreakOverlayExitFailsafe.test.tsx) still works in the Orb Journey
// context -- the task's own brief requires this explicitly, since Journey
// reuses the SAME overlay exit machinery. The fail-safe timeout effect in
// MicroBreakOverlay.tsx operates purely on `phase === 'exiting'`, with no
// sessionType branching at all, so this is expected to pass unchanged --
// this file exists to PROVE that, not assume it. Mirrors
// MicroBreakOverlayExitFailsafe.test.tsx's own stuck-animation mock
// (deliberately different from this directory's OTHER Journey test file,
// MicroBreakOverlayJourney.test.tsx, which mocks framer-motion to complete
// SYNCHRONOUSLY -- a stuck mock and a synchronous mock cannot coexist in one
// file since vi.mock is file-scoped).
//
// JourneyCanvas itself is NOT mocked here (same choice
// MicroBreakOverlayExitFailsafe.test.tsx makes for PongCanvas) -- jsdom's
// canvas getContext() returns null, and JourneyCanvas's renderFrame() has
// the same `if (!canvas || !ctx) return` guard PongCanvas does, so it mounts
// and no-ops safely without needing a mock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MotionDivMock({ children, ...rest }: Record<string, any>) {
    // Deliberately never calls onAnimationComplete -- simulates a handoff
    // animation that never resolves.
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

describe('MicroBreakOverlay Orb Journey exit fail-safe (MB-05, re-verifying MB-03-FIX)', () => {
  it('if the handoff animation never completes during a Journey session, the SAME fail-safe timeout still tears the overlay down', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await vi.waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Orb Journey' }));
    });
    await vi.waitFor(() => expect(document.querySelector('canvas')).not.toBeNull());

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close micro break' }));
    });
    // Animation mock never fires onAnimationComplete -- still stuck 'exiting'.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(useMicroBreaksStore.getState().gameActive).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000); // well past HANDOFF_TRANSITION_SECONDS (0.28s) + the 1s safety margin
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(useMicroBreaksStore.getState().gameActive).toBe(false);
  });
});
