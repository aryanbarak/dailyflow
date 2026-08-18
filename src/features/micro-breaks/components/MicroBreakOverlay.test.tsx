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

const { MicroBreakOverlay } = await import('./MicroBreakOverlay');
const { useMicroBreaksStore } = await import('../store/microBreaksStore');

function resetStore() {
  useMicroBreaksStore.setState({ gameActive: false, mode: 'classic', score: 0 });
}

beforeEach(() => {
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

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Micro break: Classic Pong');
    expect(document.activeElement).not.toBe(trigger); // initial focus moved inside the overlay
    expect(dialog.contains(document.activeElement)).toBe(true);
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

  it('scroll-lock: body overflow is hidden while the overlay is open and restored on close', async () => {
    render(<MicroBreakOverlay />);
    act(() => {
      useMicroBreaksStore.getState().startBreak();
    });
    await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.body.style.overflow).toBe('');
  });

  it('the visible close button closes the overlay the same way Esc does', async () => {
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
    const dialog = await screen.findByRole('dialog');

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
    const dialog = await screen.findByRole('dialog');
    const first = dialog.querySelectorAll('button')[0] as HTMLElement;
    first.focus();

    const focusSpy = vi.spyOn(first, 'focus');
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(focusSpy).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
  });
});
