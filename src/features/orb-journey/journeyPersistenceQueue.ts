// MB-20, ADR-0015 §14: "On write failure: queued in localStorage, retried on
// next app load or the next online event." Same localStorage-backed zustand
// `persist` middleware convention appearanceStore.ts already establishes for
// this codebase (see that store's own comment) -- not a new storage
// mechanism. Deliberately a SEPARATE store from appearanceStore, though: this
// is session-runtime write-retry state, not a user preference (the same
// "runtime state and preferences stay separate" spirit microBreaksStore.ts's
// own comment already documents for gameActive/score).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createId } from '@/lib/id';
import { supabase as defaultClient } from '@/integrations/supabase/client';
import {
  journeyPersistenceService,
  type JourneyPersistenceClient,
  type JourneyProgressCandidate,
  type JourneyRunSummary,
} from './journeyPersistenceService';

interface QueuedProgressWrite {
  readonly kind: 'progress';
  readonly entryId: string;
  readonly payload: JourneyProgressCandidate;
}

interface QueuedRunWrite {
  readonly kind: 'run';
  readonly entryId: string;
  readonly payload: JourneyRunSummary;
}

export type QueuedJourneyWrite = QueuedProgressWrite | QueuedRunWrite;

interface JourneyPersistenceQueueState {
  readonly queue: readonly QueuedJourneyWrite[];
  readonly enqueue: (write: { kind: 'progress'; payload: JourneyProgressCandidate } | { kind: 'run'; payload: JourneyRunSummary }) => void;
  readonly remove: (entryId: string) => void;
}

export const useJourneyPersistenceQueueStore = create<JourneyPersistenceQueueState>()(
  persist(
    (set, get) => ({
      queue: [],
      // entryId is a LOCAL queue-bookkeeping id (removal handle), distinct
      // from JourneyRunSummary's own `id` (the createId() the caller
      // generated at session start for the idempotent-retry contract) --
      // a progress write has no id of its own at all, so this store needs
      // its own regardless.
      enqueue: write => set({ queue: [...get().queue, { ...write, entryId: createId() } as QueuedJourneyWrite] }),
      remove: entryId => set({ queue: get().queue.filter(item => item.entryId !== entryId) }),
    }),
    { name: 'smartflow:orb-journey-persistence-queue' },
  ),
);

// MB-20: flushes each queued write AT MOST ONCE per call -- a write that
// fails again simply stays queued for the NEXT trigger (the next app load,
// or the next 'online' event via useNetworkStatus in MicroBreakOverlay.tsx),
// never a busy/polling retry loop within this function itself. `flushInFlight`
// guards against the app-load flush and an 'online' event flush overlapping
// (e.g. connectivity flips back on within the same tick the app finishes
// loading) and racing each other over the same queue items.
let flushInFlight = false;

export async function flushJourneyPersistenceQueue(client: JourneyPersistenceClient = defaultClient): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    // Snapshot at call time -- a write enqueued WHILE this flush is running
    // (e.g. a session ends mid-flush) is intentionally left for the NEXT
    // flush rather than raced into this one.
    const items = useJourneyPersistenceQueueStore.getState().queue;
    for (const item of items) {
      try {
        if (item.kind === 'run') {
          await journeyPersistenceService.insertJourneyRun(client, item.payload);
        } else {
          await journeyPersistenceService.upsertJourneyProgressIfBetter(client, item.payload);
        }
        useJourneyPersistenceQueueStore.getState().remove(item.entryId);
      } catch {
        // Stays queued -- retried by the next trigger, not here.
      }
    }
  } finally {
    flushInFlight = false;
  }
}
