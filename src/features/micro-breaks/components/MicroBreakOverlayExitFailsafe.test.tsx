// @vitest-environment jsdom
//
// MB-03-FIX: production regression -- pull-to-refresh stopped working
// anywhere in the app after MB-03 shipped. Root cause: the dialog root's
// gesture guards (overscroll-behavior/touch-action) were applied for the
// WHOLE 'active' | 'exiting' | 'error' lifespan, and the only path back to
// 'idle' during exit is the handoff animation's onAnimationComplete
// callback. If that callback never fires -- a backgrounded tab suspending
// the animation's rAF mid-flight, a framer-motion edge case, or any other
// page-visibility hiccup during the ~280ms exit transition -- the dialog
// (and its full-viewport gesture guard) stayed mounted indefinitely.
//
// Unlike MicroBreakOverlay.test.tsx (which mocks framer-motion to complete
// SYNCHRONOUSLY so it can test the normal, healthy exit path), this file
// mocks it to simulate a STUCK animation -- onAnimationComplete is captured
// but deliberately never invoked -- so the fail-safe timeout path itself is
// exercised, not just the happy path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MotionDivMock({ children, ...rest }: Record<string, any>) {
    // Deliberately never calls onAnimationComplete -- simulates a handoff
    // animation that never resolves (e.g. a backgrounded tab suspending its
    // rAF mid-flight).
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

describe('MicroBreakOverlay exit fail-safe (MB-03-FIX)', () => {
  it('gesture guards (touch-action/overscroll-behavior) are OFF once exiting, even before the handoff animation resolves', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    const dialog = await screen.findByRole('dialog');
    // While actually playing, the guard IS on.
    expect(dialog.style.touchAction).toBe('none');
    expect(dialog.style.overscrollBehavior).toBe('contain');

    fireEvent.click(screen.getByRole('button', { name: 'Close micro break' }));

    // The mock never resolves the handoff animation, so this is still
    // mounted ('exiting') -- but the guard must already be off.
    const stillMountedDialog = screen.getByRole('dialog');
    expect(stillMountedDialog.style.touchAction).not.toBe('none');
    expect(stillMountedDialog.style.overscrollBehavior).not.toBe('contain');
  });

  it('if the handoff animation never completes, a fail-safe timeout still tears the overlay down (body scroll-lock restored, dialog unmounted, gameActive false)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await vi.waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(document.body.style.overflow).toBe('hidden');

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
