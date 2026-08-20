// @vitest-environment jsdom
//
// ADR-0014 §3, MB-02 slice 1: overlay lifecycle + focus containment.
// framer-motion is mocked to a synchronous stub -- real animation timing is
// framer-motion's own concern, not this component's; what THIS component
// owns (and what these tests verify) is the sequencing around that
// animation: scroll-lock, focus save/restore, rAF/listener teardown, and
// gameActive transitions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MotionDivMock({ children, onAnimationComplete, animate, ...rest }: Record<string, any>) {
    React.useEffect(() => {
      onAnimationComplete?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animate?.x, animate?.y]);
    delete rest.initial;
    delete rest.transition;
    return React.createElement('div', rest, children);
  }
  return {
    motion: { div: MotionDivMock },
    useReducedMotion: () => false,
  };
});

// MB-20: MicroBreakOverlay now reads journey_progress (a non-blocking,
// fire-and-forget read) the instant ANY session reaches the 'choosing'
// phase -- Quick Break included, since the picker itself is common to both
// session types. This file never touches Journey/persistence at all, so
// the whole module is mocked away to keep this file's tests hermetic (no
// real network attempt against the real Supabase client in jsdom).
vi.mock('@/features/orb-journey/journeyPersistenceRuntime', () => ({
  loadJourneyProgressOnce: vi.fn(),
  maybeRecordRoomCompletion: vi.fn(),
  recordJourneySessionEnd: vi.fn(),
  useJourneyProgressCache: vi.fn(() => undefined),
}));
vi.mock('@/features/orb-journey/journeyPersistenceQueue', () => ({
  flushJourneyPersistenceQueue: vi.fn(),
  useJourneyPersistenceQueueStore: { getState: () => ({ enqueue: vi.fn() }) },
}));
// MicroBreakOverlay.tsx now also imports the real `supabase` singleton
// directly (to pass as the client argument to the two mocked modules
// above) -- constructing the REAL client throws outside a configured env
// (see supabaseConfig.ts), so it's mocked to an inert placeholder here too.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

// MB-03: MicroBreakOverlay now imports appearanceStore (for the duration
// preset), whose `persist` middleware resolves `localStorage` at
// STORE-CREATION time (module evaluation), not lazily per call -- mirrors
// appearanceStore.test.ts's own MemoryStorage pattern. Must be stubbed
// BEFORE the dynamic imports below, since those trigger that module
// evaluation.
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

// ADR-0015 §8: the overlay now shows a session-type choice screen before
// either game starts -- every existing lifecycle/focus test below needs to
// pick "Quick Break" first to reach the same game-active state it used to
// land on immediately. This is exactly the behavior change ADR-0015 §8
// requires, not a regression: PongCanvas itself, once reached, receives the
// identical props it always did (see MicroBreakOverlay.tsx's own render).
async function chooseQuickBreak() {
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Quick Break' }));
  return dialog;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  resetStore();
  document.body.style.overflow = '';
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  // jsdom has no ResizeObserver (MB-03's resize/rescale wiring needs a real
  // browser -- see e2e/microBreaksRendering.spec.ts and PongCanvas.tsx's own
  // `typeof ResizeObserver === 'undefined'` fallback guard for the
  // no-throw-in-jsdom proof); this stub only needs to exist, not actually
  // observe anything, for these DOM-lifecycle-focused tests.
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
});

describe('MicroBreakOverlay lifecycle (ADR-0014 §3)', () => {
  it('open -> play -> Esc: cancels the game rAF, removes the keydown listener, restores focus, and flips gameActive back to false', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });

    const choosingDialog = await screen.findByRole('dialog');
    expect(choosingDialog).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).not.toBe(trigger); // initial focus moved inside the overlay
    expect(choosingDialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(choosingDialog).getByRole('button', { name: 'Quick Break' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Micro break: Classic Pong');
    expect(useMicroBreaksStore.getState().gameActive).toBe(true);

    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(cancelSpy).toHaveBeenCalled(); // PongCanvas's own rAF loop torn down immediately, before the exit animation
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useMicroBreaksStore.getState().gameActive).toBe(false);
    expect(document.activeElement).toBe(trigger); // focus restored to the pre-open element

    document.body.removeChild(trigger);
  });

  it('scroll-lock: body overflow is hidden while the overlay is open (through the choice screen and into gameplay) and restored on close', async () => {
    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });
    await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden'); // already locked on the choice screen, ADR-0014 §3 applies to the whole dialog
    await chooseQuickBreak();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });

  it('the visible close button closes the overlay the same way Esc does', async () => {
    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });
    const dialog = await chooseQuickBreak();
    const closeButton = within(dialog).getByRole('button', { name: 'Close micro break' });

    fireEvent.click(closeButton);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useMicroBreaksStore.getState().gameActive).toBe(false);
  });

  it('the visible close button closes the overlay from the choice screen too (before any session type is picked)', async () => {
    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });
    const dialog = await screen.findByRole('dialog');
    const closeButton = within(dialog).getByRole('button', { name: 'Close micro break' });

    fireEvent.click(closeButton);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useMicroBreaksStore.getState().gameActive).toBe(false);
  });
});

describe('MicroBreakOverlay focus containment (ADR-0014 §3)', () => {
  it('Tab from the last (only) focusable element re-asserts focus on it via the wrap logic, never letting it drift away', async () => {
    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });
    const dialog = await chooseQuickBreak();

    const focusable = dialog.querySelectorAll('button');
    const last = focusable[focusable.length - 1] as HTMLElement;
    last.focus();
    expect(document.activeElement).toBe(last);

    // jsdom does not natively advance focus on Tab the way a real browser
    // does -- the meaningful, non-tautological signal here is that OUR
    // wrap logic explicitly re-asserts focus (calls .focus() again) in
    // response to the keydown, not that focus merely "didn't move" (which
    // would be true even if the handler did nothing at all).
    const focusSpy = vi.spyOn(last, 'focus');
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(focusSpy).toHaveBeenCalled();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Escape' });
  });

  it('Shift+Tab from the first (only) focusable element also re-asserts focus on it', async () => {
    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });
    const dialog = await chooseQuickBreak();
    const first = dialog.querySelectorAll('button')[0] as HTMLElement;
    first.focus();

    const focusSpy = vi.spyOn(first, 'focus');
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(focusSpy).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
  });
});

// MB-14, ADR-0015 §13: Quick Break regression guard. The growth formula
// (getJourneyPlayAreaMaxWidthPx) and the room-index-derived inline
// max-width/transition style it feeds are Journey-only additions to
// MicroBreakOverlay.tsx's render -- this proves it on the ACTUAL rendered
// DOM output for a real Quick Break session (this file keeps the REAL
// PongCanvas, per its own header comment), not just "no Quick Break files
// changed" by omission.
describe('MicroBreakOverlay: Quick Break play-area sizing is UNAFFECTED by MB-14 (ADR-0015 §13, Journey-only)', () => {
  it('the Quick Break canvas container keeps its exact pre-MB-14 max-w-[480px] class, with NO room-index-derived inline max-width or transition style', async () => {
    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });
    const dialog = await chooseQuickBreak();

    const canvas = dialog.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const container = canvas!.parentElement as HTMLElement;

    expect(container.className).toContain('max-w-[480px]');
    // The Journey container's inline style sets BOTH of these (see
    // MicroBreakOverlay.tsx's own render) -- their absence here is the
    // actual, checkable proof Quick Break's sizing pipeline was never
    // touched, not an assumption.
    expect(container.style.maxWidth).toBe('');
    expect(container.style.transition).toBe('');
  });
});

// MB-22, ADR-0014 §2 (updated): Journey's HUD moved INSIDE its play-area
// container this task, because MB-17's (correct) dim/blur scoping left the
// OLD outside-the-boundary HUD position illegible against the now-bright
// dashboard. Quick Break's dim/blur has always been full-viewport (ADR-0014
// §2's original wash) -- its HUD was therefore NEVER over an undimmed area,
// so it has no equivalent regression to fix and must stay exactly where it
// was, byte-for-byte. Verified here on the real rendered DOM, not assumed
// from "Quick Break's render branch wasn't edited."
describe('MicroBreakOverlay: Quick Break HUD position is UNCHANGED by MB-22 (Journey-only HUD relocation)', () => {
  it('the Quick Break HUD (score/time) is a SIBLING of the canvas container, positioned against the dialog root -- NOT relocated inside the container the way Journeys was', async () => {
    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });
    const dialog = await chooseQuickBreak();

    const scoreLabel = await screen.findByText('Score: 0');
    const canvas = dialog.querySelector('canvas') as HTMLCanvasElement;
    const canvasContainer = canvas.parentElement as HTMLElement;

    // Still a descendant of the dialog (never removed from the tree)...
    expect(dialog.contains(scoreLabel)).toBe(true);
    // ...but NOT a descendant of the canvas container -- this is the actual
    // "unrelocated" claim: Journey's HUD (see MicroBreakOverlayJourney.test.tsx)
    // is now INSIDE its own canvas container; Quick Break's must not be.
    expect(canvasContainer.contains(scoreLabel)).toBe(false);

    const hudWrapper = scoreLabel.closest('[class*="absolute"]') as HTMLElement;
    expect(hudWrapper.parentElement).toBe(dialog);
    expect(hudWrapper.parentElement).not.toBe(canvasContainer);

    // The exact same styling contract as before this task -- safe-area-
    // anchored top-left, semi-transparent card background, z-10 above the
    // canvas -- byte-for-byte, not just "still renders somewhere."
    expect(hudWrapper.className).toContain('absolute');
    expect(hudWrapper.className).toContain('z-10');
    expect(hudWrapper.className).toContain('bg-card/80');
  });
});
