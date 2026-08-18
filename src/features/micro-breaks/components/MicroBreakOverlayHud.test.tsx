// @vitest-environment jsdom
//
// MB-03: HUD wiring (combo visibility, final-wave indicator) and the
// duration-preset "read once at game start, never reactively" contract.
// PongCanvas is mocked here (unlike MicroBreakOverlay.test.tsx, which keeps
// the REAL PongCanvas specifically to prove rAF/listener teardown -- see
// that file's own comment) so these tests can trigger score/combo/time
// callbacks directly and deterministically without a real game loop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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

vi.mock('./PongCanvas', async () => {
  const React = await import('react');
  function PongCanvasMock({ onComboChange, onTimeChange }: { onComboChange: (n: number) => void; onTimeChange: (n: number) => void }) {
    return React.createElement(
      'div',
      { 'data-testid': 'pong-canvas-stub' },
      React.createElement('button', { type: 'button', onClick: () => onComboChange(1) }, 'simulate-combo-1'),
      React.createElement('button', { type: 'button', onClick: () => onComboChange(3) }, 'simulate-combo-3'),
      React.createElement('button', { type: 'button', onClick: () => onTimeChange(45) }, 'simulate-time-45'),
      React.createElement('button', { type: 'button', onClick: () => onTimeChange(8) }, 'simulate-time-8-final-wave'),
    );
  }
  return { PongCanvas: PongCanvasMock };
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
});

describe('MicroBreakOverlay HUD: combo (MB-03, ADR-0014 §11-12)', () => {
  it('combo is NOT shown when below 2', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByText('simulate-combo-1'));
    expect(screen.queryByText(/^Combo x/)).toBeNull();
  });

  it('combo IS shown once it reaches 2 or more', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByText('simulate-combo-3'));
    expect(screen.getByText('Combo x3')).toBeInTheDocument();
  });
});

describe('MicroBreakOverlay HUD: final wave (MB-03, ADR-0014 §12)', () => {
  it('is not shown with plenty of time left', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByText('simulate-time-45'));
    expect(screen.queryByText('Final stretch!')).toBeNull();
  });

  it('is shown once remaining time drops to the final-wave window (<=10s)', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByText('simulate-time-8-final-wave'));
    expect(screen.getByText('Final stretch!')).toBeInTheDocument();
  });
});

describe('MicroBreakOverlay: duration preset (MB-03, ADR-0014 §7)', () => {
  it('game start reads the CURRENT preset from appearanceStore', async () => {
    useAppearance.getState().setMicroBreakDurationSeconds(60);

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    expect(screen.getByText('Time: 60s')).toBeInTheDocument();
  });

  it('a mid-game preference change does NOT affect the already-running session', async () => {
    useAppearance.getState().setMicroBreakDurationSeconds(60);

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');
    expect(screen.getByText('Time: 60s')).toBeInTheDocument();

    // Change the PREFERENCE mid-game -- the running session must be unaffected.
    act(() => useAppearance.getState().setMicroBreakDurationSeconds(120));

    expect(screen.getByText('Time: 60s')).toBeInTheDocument();
    expect(screen.queryByText('Time: 120s')).toBeNull();
  });

  it('an invalid stored preset falls back to 90 at game start', async () => {
    useAppearance.setState({ microBreakDurationSeconds: 45 as never });

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    expect(screen.getByText('Time: 90s')).toBeInTheDocument();
  });
});
