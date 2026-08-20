import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertJourneyRunMock = vi.hoisted(() => vi.fn());
const upsertJourneyProgressIfBetterMock = vi.hoisted(() => vi.fn());

vi.mock('./journeyPersistenceService', () => ({
  journeyPersistenceService: {
    insertJourneyRun: insertJourneyRunMock,
    upsertJourneyProgressIfBetter: upsertJourneyProgressIfBetterMock,
  },
}));

// The queue's default client parameter resolves this import -- mocked so
// module evaluation never touches real env config, even though the mocked
// service functions above never actually read it.
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

const { useJourneyPersistenceQueueStore, flushJourneyPersistenceQueue } = await import('./journeyPersistenceQueue');

const fakeClient = {} as never;

beforeEach(() => {
  useJourneyPersistenceQueueStore.setState({ queue: [] });
  insertJourneyRunMock.mockReset();
  upsertJourneyProgressIfBetterMock.mockReset();
});

describe('journeyPersistenceQueue: enqueue', () => {
  it('adds a queued write with a unique entryId, preserving the caller-supplied payload untouched', () => {
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'run', payload: { id: 'run-1', endedAtRoom: 3, totalScore: 500 } });
    const { queue } = useJourneyPersistenceQueueStore.getState();
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe('run');
    expect(queue[0].payload).toEqual({ id: 'run-1', endedAtRoom: 3, totalScore: 500 });
    expect(typeof queue[0].entryId).toBe('string');
    expect(queue[0].entryId.length).toBeGreaterThan(0);
  });
});

describe('journeyPersistenceQueue: flushJourneyPersistenceQueue', () => {
  it('removes a run write from the queue once the underlying insert succeeds', async () => {
    insertJourneyRunMock.mockResolvedValue(undefined);
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'run', payload: { id: 'run-2', endedAtRoom: 2, totalScore: 100 } });

    await flushJourneyPersistenceQueue(fakeClient);

    expect(insertJourneyRunMock).toHaveBeenCalledTimes(1);
    expect(insertJourneyRunMock).toHaveBeenCalledWith(fakeClient, { id: 'run-2', endedAtRoom: 2, totalScore: 100 });
    expect(useJourneyPersistenceQueueStore.getState().queue).toEqual([]);
  });

  it('leaves a progress write queued when the underlying upsert rejects -- does NOT silently drop it', async () => {
    upsertJourneyProgressIfBetterMock.mockRejectedValue(new Error('offline'));
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'progress', payload: { farthestRoom: 3, bestTotalScore: 400, roomsDiscoveredCount: 3 } });

    await flushJourneyPersistenceQueue(fakeClient);

    expect(upsertJourneyProgressIfBetterMock).toHaveBeenCalledTimes(1);
    expect(useJourneyPersistenceQueueStore.getState().queue).toHaveLength(1); // still there -- the exact, non-tautological claim
  });

  it('flushes multiple queued items independently -- one failure does not block a later item from succeeding', async () => {
    upsertJourneyProgressIfBetterMock.mockRejectedValueOnce(new Error('offline'));
    insertJourneyRunMock.mockResolvedValueOnce(undefined);
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'progress', payload: { farthestRoom: 2, bestTotalScore: 50, roomsDiscoveredCount: 2 } });
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'run', payload: { id: 'run-3', endedAtRoom: 2, totalScore: 50 } });

    await flushJourneyPersistenceQueue(fakeClient);

    const { queue } = useJourneyPersistenceQueueStore.getState();
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe('progress'); // the failed one stayed; the run insert succeeded and was removed
  });

  it('a retried flush (simulating a later online/app-load trigger) re-sends the SAME run id -- required for on-conflict-do-nothing idempotency', async () => {
    insertJourneyRunMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'run', payload: { id: 'stable-retry-id', endedAtRoom: 4, totalScore: 900 } });

    await flushJourneyPersistenceQueue(fakeClient); // fails, stays queued
    expect(useJourneyPersistenceQueueStore.getState().queue).toHaveLength(1);

    await flushJourneyPersistenceQueue(fakeClient); // retried

    expect(insertJourneyRunMock).toHaveBeenCalledTimes(2);
    expect(insertJourneyRunMock.mock.calls[0][1].id).toBe('stable-retry-id');
    expect(insertJourneyRunMock.mock.calls[1][1].id).toBe('stable-retry-id');
    expect(useJourneyPersistenceQueueStore.getState().queue).toEqual([]);
  });
});
