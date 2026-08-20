import { beforeEach, describe, expect, it, vi } from 'vitest';

const getJourneyProgressMock = vi.hoisted(() => vi.fn());
const upsertJourneyProgressIfBetterMock = vi.hoisted(() => vi.fn());
const insertJourneyRunMock = vi.hoisted(() => vi.fn());
const enqueueMock = vi.hoisted(() => vi.fn());

vi.mock('./journeyPersistenceService', () => ({
  journeyPersistenceService: {
    getJourneyProgress: getJourneyProgressMock,
    upsertJourneyProgressIfBetter: upsertJourneyProgressIfBetterMock,
    insertJourneyRun: insertJourneyRunMock,
  },
}));

vi.mock('./journeyPersistenceQueue', () => ({
  useJourneyPersistenceQueueStore: { getState: () => ({ enqueue: enqueueMock }) },
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

const {
  useJourneyProgressCache,
  loadJourneyProgressOnce,
  maybeRecordRoomCompletion,
  recordJourneySessionEnd,
} = await import('./journeyPersistenceRuntime');

const fakeClient = {} as never;

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  useJourneyProgressCache.setState({ snapshot: undefined });
  getJourneyProgressMock.mockReset();
  upsertJourneyProgressIfBetterMock.mockReset();
  insertJourneyRunMock.mockReset();
  enqueueMock.mockReset();
});

describe('journeyPersistenceRuntime.loadJourneyProgressOnce', () => {
  it('populates the cache with a numeric snapshot from the returned row', async () => {
    getJourneyProgressMock.mockResolvedValue({
      user_id: 'u1',
      farthest_room: 3,
      best_total_score: 500,
      rooms_discovered_count: 3,
      constellation_state: {},
      updated_at: '2026-08-01T00:00:00.000Z',
    });

    loadJourneyProgressOnce(fakeClient);
    await flushMicrotasks();

    expect(useJourneyProgressCache.getState().snapshot).toEqual({ farthestRoom: 3, bestTotalScore: 500, roomsDiscoveredCount: 3 });
  });

  it('sets the cache to null (not left undefined) when the user has no checkpoint row', async () => {
    getJourneyProgressMock.mockResolvedValue(null);

    loadJourneyProgressOnce(fakeClient);
    await flushMicrotasks();

    expect(useJourneyProgressCache.getState().snapshot).toBeNull();
  });

  it('is idempotent per app session -- a second call while already loaded does NOT re-issue the read', async () => {
    getJourneyProgressMock.mockResolvedValue(null);
    loadJourneyProgressOnce(fakeClient);
    await flushMicrotasks();

    loadJourneyProgressOnce(fakeClient);
    loadJourneyProgressOnce(fakeClient);
    await flushMicrotasks();

    expect(getJourneyProgressMock).toHaveBeenCalledTimes(1); // the actual, precise claim -- not just "no error"
  });

  it('a read failure resolves the cache to null rather than leaving the picker waiting forever', async () => {
    getJourneyProgressMock.mockRejectedValue(new Error('offline'));

    loadJourneyProgressOnce(fakeClient);
    await flushMicrotasks();

    expect(useJourneyProgressCache.getState().snapshot).toBeNull();
  });
});

describe('journeyPersistenceRuntime.maybeRecordRoomCompletion', () => {
  it('returns synchronously (not a Promise) even when the underlying write hangs -- proves the caller (the physics tick) is never made to await it', () => {
    let resolveHangingWrite: (() => void) | undefined;
    upsertJourneyProgressIfBetterMock.mockReturnValue(new Promise<void>(resolve => (resolveHangingWrite = resolve)));

    const returnValue = maybeRecordRoomCompletion(fakeClient, 2, 100);

    expect(returnValue).toBeUndefined(); // async functions would ALSO return undefined-from-the-caller's-view here (never a hung value) -- see this file's own report for the fuller reasoning
    resolveHangingWrite?.(); // avoid leaving a dangling unresolved promise across tests
  });

  it('does NOT call the service at all when the cache already shows this room is not an improvement -- the round-trip-avoidance requirement, not just "no write"', async () => {
    useJourneyProgressCache.setState({ snapshot: { farthestRoom: 5, bestTotalScore: 900, roomsDiscoveredCount: 5 } });

    maybeRecordRoomCompletion(fakeClient, 3, 200);
    await flushMicrotasks();

    expect(upsertJourneyProgressIfBetterMock).not.toHaveBeenCalled();
  });

  it('calls the service when the cache is not loaded yet (undefined) -- the service own read+compare is the correctness backstop', async () => {
    upsertJourneyProgressIfBetterMock.mockResolvedValue(undefined);

    maybeRecordRoomCompletion(fakeClient, 2, 50);
    await flushMicrotasks();

    expect(upsertJourneyProgressIfBetterMock).toHaveBeenCalledWith(fakeClient, { farthestRoom: 2, bestTotalScore: 50, roomsDiscoveredCount: 2 });
  });

  it('calls the service and optimistically updates the cache when the new room genuinely improves on it', async () => {
    useJourneyProgressCache.setState({ snapshot: { farthestRoom: 2, bestTotalScore: 100, roomsDiscoveredCount: 2 } });
    upsertJourneyProgressIfBetterMock.mockResolvedValue(undefined);

    maybeRecordRoomCompletion(fakeClient, 3, 80); // room improves, score is lower than stored best
    await flushMicrotasks();

    expect(upsertJourneyProgressIfBetterMock).toHaveBeenCalledWith(fakeClient, { farthestRoom: 3, bestTotalScore: 80, roomsDiscoveredCount: 3 });
    expect(useJourneyProgressCache.getState().snapshot).toEqual({ farthestRoom: 3, bestTotalScore: 100, roomsDiscoveredCount: 3 }); // bestTotalScore max-merged, not regressed
  });

  it('enqueues the write for offline retry when the service call rejects', async () => {
    upsertJourneyProgressIfBetterMock.mockRejectedValue(new Error('offline'));

    maybeRecordRoomCompletion(fakeClient, 2, 60);
    await flushMicrotasks();

    expect(enqueueMock).toHaveBeenCalledWith({ kind: 'progress', payload: { farthestRoom: 2, bestTotalScore: 60, roomsDiscoveredCount: 2 } });
  });
});

describe('journeyPersistenceRuntime.recordJourneySessionEnd', () => {
  it('fires BOTH the run insert and the progress upsert, unconditionally (the run insert is never gated on "did the score improve")', async () => {
    insertJourneyRunMock.mockResolvedValue(undefined);
    upsertJourneyProgressIfBetterMock.mockResolvedValue(undefined);

    recordJourneySessionEnd(
      fakeClient,
      { id: 'run-x', endedAtRoom: 1, totalScore: 0 },
      { farthestRoom: 1, bestTotalScore: 0, roomsDiscoveredCount: 1 },
    );
    await flushMicrotasks();

    expect(insertJourneyRunMock).toHaveBeenCalledWith(fakeClient, { id: 'run-x', endedAtRoom: 1, totalScore: 0 });
    expect(upsertJourneyProgressIfBetterMock).toHaveBeenCalledWith(fakeClient, { farthestRoom: 1, bestTotalScore: 0, roomsDiscoveredCount: 1 });
  });

  it('enqueues each write independently for offline retry on its own failure', async () => {
    insertJourneyRunMock.mockRejectedValue(new Error('offline'));
    upsertJourneyProgressIfBetterMock.mockRejectedValue(new Error('offline'));

    recordJourneySessionEnd(
      fakeClient,
      { id: 'run-y', endedAtRoom: 2, totalScore: 300 },
      { farthestRoom: 2, bestTotalScore: 300, roomsDiscoveredCount: 2 },
    );
    await flushMicrotasks();

    expect(enqueueMock).toHaveBeenCalledWith({ kind: 'run', payload: { id: 'run-y', endedAtRoom: 2, totalScore: 300 } });
    expect(enqueueMock).toHaveBeenCalledWith({ kind: 'progress', payload: { farthestRoom: 2, bestTotalScore: 300, roomsDiscoveredCount: 2 } });
  });
});
