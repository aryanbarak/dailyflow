// @vitest-environment jsdom
//
// ADR-0015 §8: the session-type choice screen and the Orb Journey HUD wiring
// (room number, running score, no timer -- the key visual difference from
// Quick Break's countdown). JourneyCanvas is mocked here (same reasoning as
// MicroBreakOverlayHud.test.tsx's PongCanvas mock: these tests need to
// trigger room/score/phase callbacks directly and deterministically, not
// run a real game loop) -- MicroBreakOverlay.test.tsx separately keeps the
// REAL PongCanvas to prove Quick Break's rAF/listener teardown, which this
// file does not touch.
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

vi.mock('@/features/orb-journey/JourneyCanvas', async () => {
  const React = await import('react');
  function JourneyCanvasMock({
    onRoomChange,
    onScoreChange,
    onPhaseChange,
    onRenderError,
  }: {
    onRoomChange: (n: number, score: number) => void;
    onScoreChange: (n: number) => void;
    onPhaseChange: (p: 'playing' | 'cleared') => void;
    onRenderError: (error: unknown) => void;
  }) {
    return React.createElement(
      'div',
      { 'data-testid': 'journey-canvas-stub' },
      React.createElement('button', { type: 'button', onClick: () => onRoomChange(2, 0) }, 'simulate-room-2'),
      React.createElement('button', { type: 'button', onClick: () => onRoomChange(3, 0) }, 'simulate-room-3'),
      React.createElement('button', { type: 'button', onClick: () => onScoreChange(12) }, 'simulate-score-12'),
      React.createElement('button', { type: 'button', onClick: () => onPhaseChange('cleared') }, 'simulate-cleared'),
      React.createElement('button', { type: 'button', onClick: () => onRenderError(new Error('simulated Journey draw() failure')) }, 'simulate-crash'),
    );
  }
  return { JourneyCanvas: JourneyCanvasMock };
});

// MB-20: this file drives full Journey sessions (room/score changes, exit
// paths) but is not itself about persistence -- the module is mocked away
// so those sessions never touch the real journeyPersistenceService/Supabase
// client (see MicroBreakOverlayJourneyPersistence.test.tsx for the
// dedicated persistence-behavior tests, which mock at the SERVICE layer
// instead so the runtime module's own real logic runs under test).
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
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

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
const { JOURNEY_PLAY_AREA_MAX_WIDTH_PX } = await import('@/features/orb-journey/tuning');

function resetStore() {
  useMicroBreaksStore.setState({ gameActive: false, mode: 'classic', score: 0 });
  useAppearance.setState({ microBreakDurationSeconds: 90 });
}

async function chooseJourney() {
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Orb Journey' }));
  await screen.findByTestId('journey-canvas-stub');
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

describe('MicroBreakOverlay: session-type choice screen (ADR-0015 §8)', () => {
  it('shows the choice screen (not a game) immediately on open', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: 'Quick Break' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Orb Journey' })).toBeInTheDocument();
    expect(screen.queryByTestId('journey-canvas-stub')).toBeNull();
  });

  it('picking Orb Journey mounts JourneyCanvas and shows Room 1, Score: 0, with NO timer text anywhere', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    expect(screen.getByText('Room 1')).toBeInTheDocument();
    expect(screen.getByText('Score: 0')).toBeInTheDocument();
    expect(screen.queryByText(/^Time:/)).toBeNull(); // ADR-0015 §6: untimed, no countdown display
  });
});

describe('MicroBreakOverlay: Orb Journey HUD (ADR-0015 §6)', () => {
  it('room number and score update from JourneyCanvas callbacks', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    fireEvent.click(screen.getByText('simulate-room-2'));
    fireEvent.click(screen.getByText('simulate-score-12'));

    expect(screen.getByText('Room 2')).toBeInTheDocument();
    expect(screen.getByText('Score: 12')).toBeInTheDocument();
  });

  it('shows the "cleared" acknowledgement once the final configured room is cleared', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    expect(screen.queryByText('Rooms cleared — keep playing!')).toBeNull();
    fireEvent.click(screen.getByText('simulate-cleared'));
    expect(screen.getByText('Rooms cleared — keep playing!')).toBeInTheDocument();
  });
});

describe('MicroBreakOverlay: Orb Journey exit path (ADR-0014 §3, reused unchanged)', () => {
  it('Esc exits cleanly from an active Journey session: dialog gone, gameActive false, JourneyCanvas unmounted', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('journey-canvas-stub')).toBeNull();
    expect(useMicroBreaksStore.getState().gameActive).toBe(false);
  });

  it('re-opening after a Journey session starts back at the choice screen, with room/score reset for next time', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();
    fireEvent.click(screen.getByText('simulate-room-2'));
    fireEvent.click(screen.getByText('simulate-score-12'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: 'Orb Journey' })).toBeInTheDocument();

    await chooseJourney();
    expect(screen.getByText('Room 1')).toBeInTheDocument();
    expect(screen.getByText('Score: 0')).toBeInTheDocument();
  });
});

// MB-22, ADR-0015 §13 (retirement): the room-index growth formula (MB-14)
// is removed, not just unused -- the play area is now a FIXED width,
// identical for every Journey room. The mocked JourneyCanvas's
// "simulate-room-N" buttons fire onRoomChange(N) -- the SAME callback the
// real JourneyCanvas only calls at an actual room transition (see
// JourneyCanvas.tsx's onTick) -- so driving the container's max-width off
// that state (not a separate timer/effect) is what proves the width
// genuinely does NOT change across a real room transition, not just "was
// never wired to change."
describe('MicroBreakOverlay: Journey play-area is a FIXED width (MB-22, ADR-0015 §13 retirement)', () => {
  it('the Journey canvas containers max-width is the fixed JOURNEY_PLAY_AREA_MAX_WIDTH_PX constant, IDENTICAL at Room 1, 2, and 3 -- must FAIL against the old room-index growth formula (see the MB-22 report for the revert-and-capture proof)', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    const container = screen.getByTestId('journey-canvas-stub').parentElement as HTMLElement;
    expect(container.style.maxWidth).toBe(`${JOURNEY_PLAY_AREA_MAX_WIDTH_PX}px`);

    fireEvent.click(screen.getByText('simulate-room-2'));
    expect(container.style.maxWidth).toBe(`${JOURNEY_PLAY_AREA_MAX_WIDTH_PX}px`);

    fireEvent.click(screen.getByText('simulate-room-3'));
    expect(container.style.maxWidth).toBe(`${JOURNEY_PLAY_AREA_MAX_WIDTH_PX}px`);
  });

  it('the container no longer carries a max-width CSS transition -- dead code once the width never changes (MB-14s room-transition-timed growth animation is removed)', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    const container = screen.getByTestId('journey-canvas-stub').parentElement as HTMLElement;
    expect(container.style.transition).toBe('');

    const boundary = screen.getByTestId('journey-play-area-boundary');
    expect(boundary.style.transition).toBe('');
  });

  it('the play-area boundary is also the fixed 500px width, matching the canvas container exactly (the single-source-of-truth invariant, still holding with no per-room input left to drift)', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    const boundary = screen.getByTestId('journey-play-area-boundary');
    expect(boundary.style.maxWidth).toBe(`${JOURNEY_PLAY_AREA_MAX_WIDTH_PX}px`);
  });
});

// MB-22, ADR-0014 §2 (updated): the HUD (room/score) used to be a sibling
// of the play-area boundary/canvas container, positioned against the FULL
// VIEWPORT -- outside the boundary MB-17 correctly cleared to full
// brightness, which is exactly the legibility regression this task fixes.
// jsdom has no real layout engine (getBoundingClientRect() always reports
// zero-boxes), so a genuine pixel-geometry "is the HUD's box contained
// within the boundary's box" proof belongs in the Playwright suite (real
// browser layout) -- see e2e/orbJourney.spec.ts's own HUD containment test.
// What IS meaningful here, in jsdom, is DOM ancestry: the HUD must be a
// DESCENDANT of the same play-area container the boundary is sized to, not
// a sibling of it positioned against the dialog root.
describe('MicroBreakOverlay: Journey HUD relocated inside the play-area boundary (MB-22, ADR-0014 §2 update)', () => {
  it('the HUD (room number + score) is a DOM descendant of the play-area canvas container -- NOT a sibling positioned against the outer dialog root', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    const canvasContainer = screen.getByTestId('journey-canvas-stub').parentElement as HTMLElement;
    const roomLabel = screen.getByText('Room 1');
    // .contains() includes the element itself; roomLabel is a <span> nested
    // inside the HUD div, itself nested inside canvasContainer -- a real,
    // multi-level ancestry check, not just "somewhere in the document."
    expect(canvasContainer.contains(roomLabel)).toBe(true);

    // The dialog root itself (the OLD anchor, pre-MB-22) must NOT be the
    // roomLabel's immediate positioning context anymore -- i.e. the HUD's
    // own wrapper div is not a direct child of the dialog root.
    const dialog = screen.getByRole('dialog');
    const hudWrapper = roomLabel.closest('[class*="absolute"]') as HTMLElement;
    expect(hudWrapper.parentElement).not.toBe(dialog);
    expect(hudWrapper.parentElement).toBe(canvasContainer);
  });

  it('score and cleared-state text still render correctly from inside the new location (content/behavior unchanged, only position moved)', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    fireEvent.click(screen.getByText('simulate-score-12'));
    expect(screen.getByText('Score: 12')).toBeInTheDocument();

    fireEvent.click(screen.getByText('simulate-cleared'));
    expect(screen.getByText('Rooms cleared — keep playing!')).toBeInTheDocument();
  });
});

describe('MicroBreakOverlay: crash path in the Journey context (MB-02b/MB-03-FIX pattern, unchanged)', () => {
  it('a Journey render error shows the same in-overlay error state Quick Break uses, and Esc still exits cleanly', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    // JourneyCanvas is mocked, but it's wired to the SAME onRenderError
    // callback (handleRenderError) Quick Break's real PongCanvas uses --
    // this proves the OVERLAY side of the crash path is genuinely shared,
    // not a Journey-specific reimplementation. The real JourneyCanvas's own
    // draw()-throws guard is proven separately in a real browser (fault
    // injection, mirroring microBreaksRendering.spec.ts's own pattern) --
    // see e2e/orbJourney.spec.ts.
    fireEvent.click(screen.getByText('simulate-crash'));

    expect(screen.getByText('Something went wrong with the game. You can close this and try again.')).toBeInTheDocument();
    expect(screen.queryByTestId('journey-canvas-stub')).toBeNull(); // unmounted immediately, same as PongCanvas's crash path

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useMicroBreaksStore.getState().gameActive).toBe(false);
  });
});
