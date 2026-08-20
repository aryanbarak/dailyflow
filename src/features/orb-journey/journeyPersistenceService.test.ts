import { describe, expect, it, vi } from 'vitest';
import {
  journeyPersistenceService,
  type JourneyPersistenceClient,
  type JourneyProgressRow,
} from './journeyPersistenceService';

// MB-19: journeyPersistenceService.ts takes the Supabase client as an
// INJECTED parameter (not the module-level singleton moodService.ts closes
// over), specifically so unit tests never need to mock
// @/integrations/supabase/client or touch the network -- a fake client
// object is constructed directly here instead. Chainable query stub
// mirrors this repo's own established mocking shape (tasksService.test.ts's
// `readQuery`/`updateQuery` helpers), extended with an `upsert` spy whose
// calls are recorded so tests can assert "was NOT called" precisely, not
// just "produced no error."
function createFakeClient(options: { authenticated?: boolean; progressRow?: JourneyProgressRow | null } = {}) {
  const { authenticated = true, progressRow = null } = options;
  const upsertCalls: Array<{ table: string; row: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const fromCalls: string[] = [];

  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: authenticated ? { id: 'user-1' } : null } })),
    },
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: progressRow, error: null })),
        upsert: vi.fn(async (row: Record<string, unknown>, opts: Record<string, unknown>) => {
          upsertCalls.push({ table, row, options: opts });
          return { data: null, error: null };
        }),
      };
      return query;
    }),
  };

  return { client: client as unknown as JourneyPersistenceClient, upsertCalls, fromCalls };
}

function progressRow(overrides: Partial<JourneyProgressRow> = {}): JourneyProgressRow {
  return {
    user_id: 'user-1',
    farthest_room: 3,
    best_total_score: 500,
    rooms_discovered_count: 3,
    constellation_state: { rooms: ['focus-tasks', 'rhythm-calendar'] },
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('journeyPersistenceService.getJourneyProgress', () => {
  it('returns null for a user with no checkpoint row', async () => {
    const { client } = createFakeClient({ progressRow: null });
    const result = await journeyPersistenceService.getJourneyProgress(client);
    expect(result).toBeNull();
  });

  it("returns the row's full shape when a checkpoint exists", async () => {
    const row = progressRow();
    const { client } = createFakeClient({ progressRow: row });
    const result = await journeyPersistenceService.getJourneyProgress(client);
    expect(result).toEqual(row);
  });

  it('throws "Not authenticated" when there is no signed-in user, and never queries the table', async () => {
    const { client, fromCalls } = createFakeClient({ authenticated: false });
    await expect(journeyPersistenceService.getJourneyProgress(client)).rejects.toThrow('Not authenticated');
    expect(fromCalls).toEqual([]); // auth is checked BEFORE any query is issued
  });
});

describe('journeyPersistenceService.upsertJourneyProgressIfBetter', () => {
  it('writes nothing when the candidate improves NEITHER farthest_room NOR best_total_score than the stored checkpoint', async () => {
    const stored = progressRow({ farthest_room: 3, best_total_score: 500 });
    const { client, upsertCalls } = createFakeClient({ progressRow: stored });

    await journeyPersistenceService.upsertJourneyProgressIfBetter(client, {
      farthestRoom: 2, // worse
      bestTotalScore: 400, // worse
      roomsDiscoveredCount: 2,
    });

    expect(upsertCalls).toEqual([]); // the actual, precise claim -- not just "no throw"
  });

  it('writes (and max-merges) when the candidate improves farthest_room ONLY, even though its score is lower', async () => {
    const stored = progressRow({ farthest_room: 3, best_total_score: 500, rooms_discovered_count: 3 });
    const { client, upsertCalls } = createFakeClient({ progressRow: stored });

    await journeyPersistenceService.upsertJourneyProgressIfBetter(client, {
      farthestRoom: 4, // better
      bestTotalScore: 100, // worse -- must NOT regress the stored best
      roomsDiscoveredCount: 4,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].table).toBe('journey_progress');
    expect(upsertCalls[0].row).toMatchObject({
      user_id: 'user-1',
      farthest_room: 4,
      best_total_score: 500, // preserved, NOT overwritten by the lower candidate score
      rooms_discovered_count: 4,
    });
    expect(upsertCalls[0].options).toEqual({ onConflict: 'user_id' });
  });

  it('writes when the candidate improves best_total_score ONLY, preserving the stored farthest_room', async () => {
    const stored = progressRow({ farthest_room: 3, best_total_score: 500 });
    const { client, upsertCalls } = createFakeClient({ progressRow: stored });

    await journeyPersistenceService.upsertJourneyProgressIfBetter(client, {
      farthestRoom: 2, // worse
      bestTotalScore: 900, // better
      roomsDiscoveredCount: 3,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].row).toMatchObject({ farthest_room: 3, best_total_score: 900 });
  });

  it('always writes the FIRST checkpoint when no row exists yet, regardless of the candidate values', async () => {
    const { client, upsertCalls } = createFakeClient({ progressRow: null });

    await journeyPersistenceService.upsertJourneyProgressIfBetter(client, {
      farthestRoom: 1,
      bestTotalScore: 0,
      roomsDiscoveredCount: 1,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].row).toMatchObject({ user_id: 'user-1', farthest_room: 1, best_total_score: 0 });
  });

  it('preserves the stored constellation_state when the candidate omits it', async () => {
    const stored = progressRow({ farthest_room: 3, constellation_state: { rooms: ['focus-tasks'] } });
    const { client, upsertCalls } = createFakeClient({ progressRow: stored });

    await journeyPersistenceService.upsertJourneyProgressIfBetter(client, {
      farthestRoom: 4,
      bestTotalScore: 0,
      roomsDiscoveredCount: 4,
    });

    expect(upsertCalls[0].row.constellation_state).toEqual({ rooms: ['focus-tasks'] });
  });

  it('throws "Not authenticated" when there is no signed-in user, and never writes', async () => {
    const { client, upsertCalls } = createFakeClient({ authenticated: false });
    await expect(
      journeyPersistenceService.upsertJourneyProgressIfBetter(client, { farthestRoom: 5, bestTotalScore: 1000, roomsDiscoveredCount: 5 }),
    ).rejects.toThrow('Not authenticated');
    expect(upsertCalls).toEqual([]);
  });
});

describe('journeyPersistenceService.insertJourneyRun', () => {
  it('passes the CLIENT-generated id through unchanged, and uses on-conflict-do-nothing (ignoreDuplicates) semantics for idempotent retry', async () => {
    const { client, upsertCalls } = createFakeClient();
    const clientGeneratedId = 'a1b2c3d4-0000-0000-0000-000000000000';

    await journeyPersistenceService.insertJourneyRun(client, {
      id: clientGeneratedId,
      endedAtRoom: 4,
      totalScore: 1250,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].table).toBe('journey_runs');
    expect(upsertCalls[0].row).toMatchObject({
      id: clientGeneratedId,
      user_id: 'user-1',
      ended_at_room: 4,
      total_score: 1250,
    });
    // The exact idempotency mechanism (ADR-0014 §6 / ADR-0015 §14: "insert
    // uses on conflict (id) do nothing") -- Supabase-js's client-side
    // equivalent is upsert + ignoreDuplicates, not a plain insert.
    expect(upsertCalls[0].options).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('a retried call with the SAME id produces a second upsert call with byte-identical conflict semantics -- the caller relies on the database to make this a safe no-op, this layer just always sends the same request shape', async () => {
    const { client, upsertCalls } = createFakeClient();
    const run = { id: 'retry-id-1', endedAtRoom: 2, totalScore: 300 };

    await journeyPersistenceService.insertJourneyRun(client, run);
    await journeyPersistenceService.insertJourneyRun(client, run); // simulated retry after a network failure

    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0].row.id).toBe(upsertCalls[1].row.id);
    expect(upsertCalls[0].options).toEqual(upsertCalls[1].options);
  });

  it('throws "Not authenticated" when there is no signed-in user, and never writes', async () => {
    const { client, upsertCalls } = createFakeClient({ authenticated: false });
    await expect(journeyPersistenceService.insertJourneyRun(client, { id: 'x', endedAtRoom: 1, totalScore: 0 })).rejects.toThrow(
      'Not authenticated',
    );
    expect(upsertCalls).toEqual([]);
  });
});
