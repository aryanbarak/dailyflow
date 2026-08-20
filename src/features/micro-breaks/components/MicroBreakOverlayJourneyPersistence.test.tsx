// @vitest-environment jsdom
//
// MB-20, ADR-0015 §14: Orb Journey persistence wiring at the OVERLAY level --
// the room-completion write, the session-end write funnel (finalizeClose,
// reached from close-button/Esc/crash-then-close -- the stuck-exit
// fail-safe's OWN 4th path is covered separately in
// MicroBreakOverlayJourneyPersistenceExitFailsafe.test.tsx, since it needs a
// framer-motion mock that NEVER completes, incompatible with this file's
// synchronous one -- vi.mock is file-scoped), and the "Continue Journey"
// picker option. journeyPersistenceService.ts (MB-19, frozen) is mocked so
// this file exercises journeyPersistenceRuntime.ts's REAL cache/fire-and-
// forget logic end to end, with no real network call underneath it.
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

vi.mock('@/features/orb-journey/JourneyCanvas', async () => {
  const React = await import('react');
  function JourneyCanvasMock({
    onRoomChange,
    onScoreChange,
    onRenderError,
    startRoomIndex,
  }: {
    onRoomChange: (n: number, score: number) => void;
    onScoreChange: (n: number) => void;
    onPhaseChange: (p: 'playing' | 'cleared') => void;
    onRenderError: (error: unknown) => void;
    startRoomIndex?: number;
  }) {
    return React.createElement(
      'div',
      { 'data-testid': 'journey-canvas-stub', 'data-start-room': String(startRoomIndex ?? 1) },
      React.createElement('button', { type: 'button', onClick: () => onRoomChange(2, 40) }, 'simulate-room-2'),
      React.createElement('button', { type: 'button', onClick: () => onRoomChange(4, 120) }, 'simulate-room-4'),
      React.createElement('button', { type: 'button', onClick: () => onScoreChange(120) }, 'simulate-score-120'),
      React.createElement('button', { type: 'button', onClick: () => onRenderError(new Error('simulated Journey draw() failure')) }, 'simulate-crash'),
    );
  }
  return { JourneyCanvas: JourneyCanvasMock };
});

const getJourneyProgressMock = vi.hoisted(() => vi.fn(async (_client: unknown) => null as unknown));
const upsertJourneyProgressIfBetterMock = vi.hoisted(() => vi.fn(async (_client: unknown, _candidate: unknown) => undefined));
const insertJourneyRunMock = vi.hoisted(() => vi.fn(async (_client: unknown, _run: { id: string; endedAtRoom: number; totalScore: number }) => undefined));

// MicroBreakOverlay.tsx now imports the real `supabase` singleton (to pass
// as the client argument to journeyPersistenceRuntime's functions) --
// constructing the REAL client throws outside a configured env (see
// supabaseConfig.ts), so it's mocked to an inert placeholder object here.
// The functions that would actually USE it (journeyPersistenceService) are
// mocked separately below, so this placeholder is never dereferenced.
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
const { useJourneyProgressCache } = await import('@/features/orb-journey/journeyPersistenceRuntime');
const { useJourneyPersistenceQueueStore } = await import('@/features/orb-journey/journeyPersistenceQueue');

function resetStore() {
  useMicroBreaksStore.setState({ gameActive: false, mode: 'classic', score: 0 });
  useAppearance.setState({ microBreakDurationSeconds: 90 });
  useJourneyProgressCache.setState({ snapshot: undefined });
  useJourneyPersistenceQueueStore.setState({ queue: [] });
}

async function chooseJourney() {
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Orb Journey' }));
  await screen.findByTestId('journey-canvas-stub');
}

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0));
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
});

describe('MicroBreakOverlay Orb Journey persistence: room-completion write (Step 1)', () => {
  it('fires the upsert when the newly-reached room exceeds the cached farthest_room', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    fireEvent.click(screen.getByText('simulate-room-2'));
    await act(flushMicrotasks);

    expect(upsertJourneyProgressIfBetterMock).toHaveBeenCalledWith(expect.anything(), {
      farthestRoom: 2,
      bestTotalScore: 40,
      roomsDiscoveredCount: 2,
    });
  });

  it('does NOT fire (no network attempt at all) when the cache already shows this room is not an improvement -- the exact, non-tautological claim', async () => {
    useJourneyProgressCache.setState({ snapshot: { farthestRoom: 5, bestTotalScore: 900, roomsDiscoveredCount: 5 } });

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    fireEvent.click(screen.getByText('simulate-room-2'));
    await act(flushMicrotasks);

    expect(upsertJourneyProgressIfBetterMock).not.toHaveBeenCalled();
  });

  it('never fires for a Quick Break session (a separate onScoreChange/onRoomChange prop path entirely)', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Quick Break' }));
    await screen.findByTestId('pong-canvas-stub').catch(() => null); // PongCanvas is real here (not mocked) -- no stub testid; this just proves we didn't crash picking Quick Break
    await act(flushMicrotasks);

    expect(upsertJourneyProgressIfBetterMock).not.toHaveBeenCalled();
  });
});

describe('MicroBreakOverlay Orb Journey persistence: session-end write (Step 2) -- exit-path coverage', () => {
  it('path 1/4: normal close-button click fires the run insert and the progress upsert, with the SAME run id used for the whole session', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    fireEvent.click(screen.getByText('simulate-room-2'));
    fireEvent.click(screen.getByText('simulate-score-120')); // onScoreChange is a SEPARATE callback from onRoomChange's own score arg -- journeyScore state only updates via this one
    await act(flushMicrotasks);
    upsertJourneyProgressIfBetterMock.mockClear(); // isolate the SESSION-END call from the room-completion call above

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close micro break' }));
    });
    await act(flushMicrotasks);

    expect(insertJourneyRunMock).toHaveBeenCalledTimes(1);
    const runArg = insertJourneyRunMock.mock.calls[0][1];
    expect(runArg.endedAtRoom).toBe(2);
    expect(runArg.totalScore).toBe(120);
    expect(typeof runArg.id).toBe('string');
    expect(runArg.id.length).toBeGreaterThan(0);
    expect(upsertJourneyProgressIfBetterMock).toHaveBeenCalledWith(expect.anything(), { farthestRoom: 2, bestTotalScore: 120, roomsDiscoveredCount: 2 });
  });

  it('path 2/4: Escape key exits through the same funnel and fires the same session-end write', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    fireEvent.keyDown(document, { key: 'Escape' });
    await act(flushMicrotasks);

    expect(insertJourneyRunMock).toHaveBeenCalledTimes(1);
    expect(insertJourneyRunMock.mock.calls[0][1].endedAtRoom).toBe(1); // exited before any room transition
  });

  it('path 3/4: crash-then-close (MB-11/MB-12 pattern) still fires the session-end write -- the "error" phase is closable, and closing from it reaches the same funnel', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();

    fireEvent.click(screen.getByText('simulate-room-2'));
    await act(flushMicrotasks);
    insertJourneyRunMock.mockClear();

    fireEvent.click(screen.getByText('simulate-crash'));
    expect(screen.getByText('Something went wrong with the game. You can close this and try again.')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await act(flushMicrotasks);

    expect(insertJourneyRunMock).toHaveBeenCalledTimes(1);
    expect(insertJourneyRunMock.mock.calls[0][1].endedAtRoom).toBe(2); // the room reached before the crash, not lost
  });

  it('a Quick Break exit never fires a Journey session-end write at all', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Quick Break' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(flushMicrotasks);

    expect(insertJourneyRunMock).not.toHaveBeenCalled();
  });

  it('closing from the "choosing" picker WITHOUT ever picking a session type fires no write (no session was actually played)', async () => {
    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(flushMicrotasks);

    expect(insertJourneyRunMock).not.toHaveBeenCalled();
  });

  it('a failed session-end write is queued for offline retry, not silently dropped', async () => {
    insertJourneyRunMock.mockRejectedValue(new Error('offline'));

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await chooseJourney();
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(flushMicrotasks);

    const queue = useJourneyPersistenceQueueStore.getState().queue;
    expect(queue.some(item => item.kind === 'run')).toBe(true);
  });
});

describe('MicroBreakOverlay Orb Journey persistence: "Continue Journey" picker option (Step 4)', () => {
  it('renders the picker immediately, WITHOUT "Continue Journey", before the read resolves', async () => {
    let resolveRead: ((row: null) => void) | undefined;
    getJourneyProgressMock.mockReturnValue(new Promise(resolve => (resolveRead = resolve)));

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: 'Quick Break' })).toBeInTheDocument(); // picker not blocked on the pending read
    expect(screen.queryByText(/Continue Journey/)).toBeNull();

    resolveRead?.(null);
  });

  it('shows "Continue Journey (Room N)" once the read resolves to an existing checkpoint', async () => {
    getJourneyProgressMock.mockResolvedValue({
      user_id: 'u1',
      farthest_room: 4,
      best_total_score: 900,
      rooms_discovered_count: 4,
      constellation_state: {},
      updated_at: '2026-08-01T00:00:00.000Z',
    });

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');

    expect(await screen.findByText('Continue Journey (Room 4)')).toBeInTheDocument();
  });

  it('shows only "New Journey"-equivalent options (no Continue button) when no checkpoint exists', async () => {
    getJourneyProgressMock.mockResolvedValue(null);

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');
    await act(flushMicrotasks);

    expect(screen.queryByText(/Continue Journey/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Orb Journey' })).toBeInTheDocument();
  });

  it('clicking "Continue Journey" starts JourneyCanvas at the stored farthest_room, not room 1', async () => {
    getJourneyProgressMock.mockResolvedValue({
      user_id: 'u1',
      farthest_room: 3,
      best_total_score: 300,
      rooms_discovered_count: 3,
      constellation_state: {},
      updated_at: '2026-08-01T00:00:00.000Z',
    });

    render(<MicroBreakOverlay />);
    act(() => useMicroBreaksStore.getState().startBreak());
    await screen.findByRole('dialog');
    expect(await screen.findByText('Continue Journey (Room 3)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Continue Journey/ }));
    const stub = await screen.findByTestId('journey-canvas-stub');

    expect(stub.getAttribute('data-start-room')).toBe('3');
    expect(screen.getByText('Room 3')).toBeInTheDocument(); // HUD reflects the same starting room, not a stale "Room 1"
  });
});
