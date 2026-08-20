// MB-20, ADR-0015 §14: the non-blocking write layer between gameplay
// (JourneyCanvas.tsx/MicroBreakOverlay.tsx) and journeyPersistenceService.ts
// (MB-19, frozen -- function signatures here are NOT touched). Every export
// in this file is fire-and-forget: it returns synchronously (never a
// Promise the caller is expected to await), per ADR-0014 §9 -- gameplay must
// never block on a network call. A failed write is hand off to
// journeyPersistenceQueue.ts's localStorage-backed retry queue instead of
// being lost.
import { create } from 'zustand';
import { supabase as defaultClient } from '@/integrations/supabase/client';
import {
  journeyPersistenceService,
  type JourneyPersistenceClient,
  type JourneyProgressCandidate,
  type JourneyRunSummary,
} from './journeyPersistenceService';
import { useJourneyPersistenceQueueStore } from './journeyPersistenceQueue';

// A trimmed, camelCase projection of JourneyProgressRow -- only the three
// numeric checkpoint fields gameplay code actually needs to compare against
// or display (the "Continue Journey (Room N)" label, the room-completion
// "did this improve?" gate). Deliberately NOT the full row: constellation_state
// is out of MB-20's scope (unused/untouched, per the task brief), and
// user_id/updated_at have no in-session use here.
export interface JourneyProgressSnapshot {
  readonly farthestRoom: number;
  readonly bestTotalScore: number;
  readonly roomsDiscoveredCount: number;
  // MB-23, ADR-0015 §14 (extended): "the score you had at your last saved
  // room" -- what "Continue Journey" restores the live score from, not 0.
  readonly checkpointScore: number;
}

interface JourneyProgressCacheState {
  // undefined: not read yet this app session. null: read completed, no
  // checkpoint exists (first-time player) OR the read failed (treated the
  // same way -- see loadJourneyProgressOnce's own comment: a failed read
  // must not block the picker, so it resolves to "no known checkpoint",
  // same as a genuine first-time player, not a distinct error state).
  readonly snapshot: JourneyProgressSnapshot | null | undefined;
  readonly setSnapshot: (snapshot: JourneyProgressSnapshot | null) => void;
}

export const useJourneyProgressCache = create<JourneyProgressCacheState>()(set => ({
  snapshot: undefined,
  setSnapshot: snapshot => set({ snapshot }),
}));

function toSnapshot(row: Awaited<ReturnType<typeof journeyPersistenceService.getJourneyProgress>>): JourneyProgressSnapshot | null {
  if (!row) return null;
  return {
    farthestRoom: row.farthest_room,
    bestTotalScore: row.best_total_score,
    roomsDiscoveredCount: row.rooms_discovered_count,
    checkpointScore: row.checkpoint_score,
  };
}

// MB-20: "read journey_progress... do not block the picker UI on this read;
// render immediately... add 'Continue' once/if the read resolves." Called
// from a useEffect keyed on the 'choosing' phase (MicroBreakOverlay.tsx) --
// idempotent per app session (the in-flight/already-loaded guards below mean
// re-opening the picker multiple times in one session never re-fires the
// network read; loadJourneyProgressOnce is not itself the source of truth,
// useJourneyProgressCache is).
let loadInFlight = false;

export function loadJourneyProgressOnce(client: JourneyPersistenceClient = defaultClient): void {
  if (useJourneyProgressCache.getState().snapshot !== undefined || loadInFlight) return;
  loadInFlight = true;
  journeyPersistenceService
    .getJourneyProgress(client)
    .then(row => useJourneyProgressCache.getState().setSnapshot(toSnapshot(row)))
    .catch(() => useJourneyProgressCache.getState().setSnapshot(null))
    .finally(() => {
      loadInFlight = false;
    });
}

function fireAndForget(promise: Promise<void>, onFailure: () => void): void {
  promise.catch(onFailure);
}

// MB-20, ADR-0015 §14 (Step 1): "On completing a room whose index exceeds
// the user's current farthest_room: a non-blocking upsert." The cache gate
// below is the "so repeated room-completions don't need a network round-trip
// just to compare 'is this better'" requirement -- when the cache is
// already loaded and this room is NOT an improvement over it, the function
// returns without ever calling the service (no network attempt at all, not
// just a non-blocking one). When the cache is still `undefined` (not loaded
// yet -- e.g. a very fast player reaches room 2 before the picker's read
// resolves), it fires anyway; upsertJourneyProgressIfBetter's own read+compare
// (MB-19, frozen) is the correctness backstop either way.
export function maybeRecordRoomCompletion(client: JourneyPersistenceClient = defaultClient, farthestRoom: number, currentScore: number): void {
  const { snapshot, setSnapshot } = useJourneyProgressCache.getState();
  if (snapshot && farthestRoom <= snapshot.farthestRoom) return;

  // MB-23: checkpointScore is set to the live currentScore, not max-merged --
  // it represents the score AT this newly-reached room, not the best score
  // ever seen (that's bestTotalScore's job).
  const candidate: JourneyProgressCandidate = {
    farthestRoom,
    bestTotalScore: currentScore,
    roomsDiscoveredCount: farthestRoom,
    checkpointScore: currentScore,
  };
  // Optimistic local update -- the NEXT room-completion this session compares
  // against this merged value, not the session-start snapshot, so repeated
  // completions don't re-fire once a later one has already superseded an
  // earlier one in flight. journeyPersistenceService's own max-merge (MB-19)
  // reconciles this with whatever the server actually holds regardless.
  setSnapshot({
    farthestRoom: Math.max(farthestRoom, snapshot?.farthestRoom ?? 0),
    bestTotalScore: Math.max(currentScore, snapshot?.bestTotalScore ?? 0),
    roomsDiscoveredCount: Math.max(farthestRoom, snapshot?.roomsDiscoveredCount ?? 0),
    checkpointScore: currentScore,
  });

  fireAndForget(journeyPersistenceService.upsertJourneyProgressIfBetter(client, candidate), () =>
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'progress', payload: candidate }),
  );
}

// MB-20, ADR-0015 §14 (Step 2): "On session end: one journey_runs insert...
// + a final journey_progress upsert if this run's score beats the stored
// best_total_score." The run insert is UNCONDITIONAL (every session gets a
// log entry, regardless of outcome) -- only the progress upsert is
// conditional, and that decision is upsertJourneyProgressIfBetter's own
// (MB-19, frozen), not re-implemented here.
export function recordJourneySessionEnd(
  client: JourneyPersistenceClient = defaultClient,
  run: JourneyRunSummary,
  progressCandidate: JourneyProgressCandidate,
): void {
  fireAndForget(journeyPersistenceService.insertJourneyRun(client, run), () =>
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'run', payload: run }),
  );
  fireAndForget(journeyPersistenceService.upsertJourneyProgressIfBetter(client, progressCandidate), () =>
    useJourneyPersistenceQueueStore.getState().enqueue({ kind: 'progress', payload: progressCandidate }),
  );
}
