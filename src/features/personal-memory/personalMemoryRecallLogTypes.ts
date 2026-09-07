// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS2).
//
// Recall log: one row per (recall event, record) pair, in
// personal_memory_recall_log. record_id is a real FK with ON DELETE
// CASCADE -- no text/content snapshot is ever stored here (see the
// migration's own comment and ADR-0023 SS2). A row's `record` is only
// present when the cited PersonalMemoryRecord still exists; a row whose
// record has since been deleted was already removed by the cascade, so
// this type never needs to represent "record was deleted" as a null case
// -- it simply isn't in the list anymore.

import type { PersonalMemoryRecordKind } from "./personalMemoryRecordTypes";

export const PERSONAL_MEMORY_RECALL_CONSUMERS = ["chat", "briefing", "tutor"] as const;
export type PersonalMemoryRecallConsumer = typeof PERSONAL_MEMORY_RECALL_CONSUMERS[number];

/** One (recall event, record) row, joined against the still-live record for display. */
export interface PersonalMemoryRecallLogEntry {
  readonly id: string;
  readonly recordId: string;
  readonly recordKind: PersonalMemoryRecordKind;
  readonly recordPrimaryText: string;
  readonly consumer: PersonalMemoryRecallConsumer;
  readonly recallBatchId: string;
  readonly createdAt: string;
}

/** Entries grouped by recallBatchId for display -- "these N records were recalled together at time T by consumer X". */
export interface PersonalMemoryRecallBatch {
  readonly recallBatchId: string;
  readonly consumer: PersonalMemoryRecallConsumer;
  readonly createdAt: string;
  readonly entries: readonly PersonalMemoryRecallLogEntry[];
}

/** Groups already-fetched entries by recallBatchId, newest batch first. Pure, no I/O -- reused by the repository and directly unit-testable. */
export function groupPersonalMemoryRecallEntriesIntoBatches(
  entries: readonly PersonalMemoryRecallLogEntry[],
): readonly PersonalMemoryRecallBatch[] {
  const byBatch = new Map<string, PersonalMemoryRecallLogEntry[]>();
  for (const entry of entries) {
    const bucket = byBatch.get(entry.recallBatchId);
    if (bucket) bucket.push(entry);
    else byBatch.set(entry.recallBatchId, [entry]);
  }

  const batches: PersonalMemoryRecallBatch[] = [];
  for (const [recallBatchId, batchEntries] of byBatch) {
    batches.push({
      recallBatchId,
      consumer: batchEntries[0].consumer,
      createdAt: batchEntries[0].createdAt,
      entries: batchEntries,
    });
  }
  return batches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
