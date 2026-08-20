// MB-19, ADR-0015 §14: Orb Journey persistence -- pure, testable functions
// against an INJECTED Supabase client (unlike moodService.ts's own
// module-level singleton import, this is a deliberate deviation the task
// itself asks for: no real network calls in unit tests, a fake client is
// passed in directly instead of module-mocking @/integrations/supabase/client).
// The identity-resolution pattern (getUser()-throws-if-unauthenticated) is
// otherwise copied unchanged from moodService.ts -- not a new approach.
//
// SCOPE (MB-19): service layer + migration only. No UI wiring
// (JourneyCanvas.tsx/MicroBreakOverlay.tsx untouched -- MB-20), no
// "Continue Journey" picker, no offline localStorage queue/retry (MB-20).
import type { SupabaseClient, User } from '@supabase/supabase-js';

// journey_progress/journey_runs are not yet in the generated Database type
// (src/integrations/supabase/types.ts) -- regenerating it requires the
// migration to actually be applied, which MB-19's own hard rule forbids
// (file only, no `supabase db push`/`migration up`). Once a future task
// applies the migration and regenerates types, this can be tightened to
// `SupabaseClient<Database>`.
export type JourneyPersistenceClient = SupabaseClient;

// Row shapes mirror the DB columns directly (snake_case), matching this
// repo's existing convention for a service's public row type (see
// mood/types.ts's own MoodLog: `user_id`, `created_at`, etc., not a
// camelCase translation layer).
export interface JourneyProgressRow {
  readonly user_id: string;
  readonly farthest_room: number;
  readonly best_total_score: number;
  readonly rooms_discovered_count: number;
  readonly constellation_state: Record<string, unknown>;
  readonly updated_at: string;
}

export interface JourneyRunRow {
  readonly id: string;
  readonly user_id: string;
  readonly ended_at_room: number;
  readonly total_score: number;
  readonly created_at: string;
}

// Candidate values from a real play session -- camelCase, since these are
// plain function inputs, not a DB row (same split moodService.ts itself
// uses: `upsert(mood, note)` takes plain args, `MoodLog` is the row shape).
export interface JourneyProgressCandidate {
  readonly farthestRoom: number;
  readonly bestTotalScore: number;
  readonly roomsDiscoveredCount: number;
  /** Optional -- omitted candidates leave the stored constellation_state
   *  untouched rather than being coerced to an empty object. */
  readonly constellationState?: Record<string, unknown>;
}

export interface JourneyRunSummary {
  /** Client-generated (crypto.randomUUID()) BEFORE calling this function --
   *  ADR-0015 §14 / ADR-0014 §6's idempotent-retry pattern requires the SAME
   *  id across every retry of the same logical session, which only the
   *  caller (not this function) can guarantee across multiple calls. */
  readonly id: string;
  readonly endedAtRoom: number;
  readonly totalScore: number;
}

// Copied from moodService.ts's own getUser() -- same error message, same
// "throw if unauthenticated" contract. Takes the client as a parameter
// (moodService.ts's version closes over the module-level singleton) since
// every function in this file receives its client as an argument.
async function getUser(client: JourneyPersistenceClient): Promise<User> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user;
}

export const journeyPersistenceService = {
  /** Null when the user has no checkpoint yet (never played Orb Journey to
   *  a persisted point) -- distinct from a network/auth error, which throws. */
  async getJourneyProgress(client: JourneyPersistenceClient): Promise<JourneyProgressRow | null> {
    const user = await getUser(client);
    const { data } = await client.from('journey_progress').select('*').eq('user_id', user.id).maybeSingle();
    return data as JourneyProgressRow | null;
  },

  // ADR-0015 §14: "a non-blocking upsert... if this run's score beats the
  // stored best_total_score" -- both farthest_room and best_total_score are
  // independently monotonic checkpoints (a session that reaches a new
  // farthest room but scores lower than a past best, or vice versa, should
  // still record whichever dimension genuinely improved, never regress the
  // other). rooms_discovered_count is treated the same way -- a count of
  // ever-discovered rooms is itself naturally non-decreasing. Reads the
  // CURRENT row first specifically so this function can decide NOT to write
  // at all when nothing improved (the task's own explicit test requirement:
  // assert the mock's upsert is NOT called, not just "no error").
  async upsertJourneyProgressIfBetter(client: JourneyPersistenceClient, candidate: JourneyProgressCandidate): Promise<void> {
    const user = await getUser(client);
    const current = await journeyPersistenceService.getJourneyProgress(client);

    const improvedRoom = !current || candidate.farthestRoom > current.farthest_room;
    const improvedScore = !current || candidate.bestTotalScore > current.best_total_score;
    if (!improvedRoom && !improvedScore) return;

    const row: Omit<JourneyProgressRow, 'updated_at'> = {
      user_id: user.id,
      farthest_room: Math.max(candidate.farthestRoom, current?.farthest_room ?? 0),
      best_total_score: Math.max(candidate.bestTotalScore, current?.best_total_score ?? 0),
      rooms_discovered_count: Math.max(candidate.roomsDiscoveredCount, current?.rooms_discovered_count ?? 0),
      constellation_state: candidate.constellationState ?? current?.constellation_state ?? {},
    };
    await client.from('journey_progress').upsert(row, { onConflict: 'user_id' });
  },

  // ADR-0014 §6's idempotency pattern via Supabase-js's upsert +
  // ignoreDuplicates (the client-SDK equivalent of SQL's
  // `on conflict (id) do nothing`) -- a retried insert with the SAME
  // client-generated id after a prior network failure is a safe no-op, not
  // a duplicate row or a thrown "already exists" error.
  async insertJourneyRun(client: JourneyPersistenceClient, run: JourneyRunSummary): Promise<void> {
    const user = await getUser(client);
    const row: Omit<JourneyRunRow, 'created_at'> = {
      id: run.id,
      user_id: user.id,
      ended_at_room: run.endedAtRoom,
      total_score: run.totalScore,
    };
    await client.from('journey_runs').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  },
};
