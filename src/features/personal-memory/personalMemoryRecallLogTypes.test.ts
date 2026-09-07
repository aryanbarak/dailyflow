// CORE-W6 (2026-09-07, ADR-0023 SS2): pure batch-grouping logic.
import { describe, expect, it } from "vitest";
import { groupPersonalMemoryRecallEntriesIntoBatches } from "./personalMemoryRecallLogTypes";
import type { PersonalMemoryRecallLogEntry } from "./personalMemoryRecallLogTypes";

function entry(overrides: Partial<PersonalMemoryRecallLogEntry> = {}): PersonalMemoryRecallLogEntry {
  return {
    id: "log-1",
    recordId: "record-1",
    recordKind: "preference",
    recordPrimaryText: "Prefers async written updates",
    consumer: "chat",
    recallBatchId: "batch-1",
    createdAt: "2026-09-07T09:00:00.000Z",
    ...overrides,
  };
}

describe("groupPersonalMemoryRecallEntriesIntoBatches", () => {
  it("groups entries sharing a recallBatchId into one batch", () => {
    const result = groupPersonalMemoryRecallEntriesIntoBatches([
      entry({ id: "log-1", recallBatchId: "batch-1" }),
      entry({ id: "log-2", recallBatchId: "batch-1", recordId: "record-2" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].entries).toHaveLength(2);
  });

  it("orders batches newest-first", () => {
    const result = groupPersonalMemoryRecallEntriesIntoBatches([
      entry({ id: "log-1", recallBatchId: "batch-old", createdAt: "2026-09-01T00:00:00.000Z" }),
      entry({ id: "log-2", recallBatchId: "batch-new", createdAt: "2026-09-07T00:00:00.000Z" }),
    ]);
    expect(result.map((b) => b.recallBatchId)).toEqual(["batch-new", "batch-old"]);
  });

  it("returns an empty list for no entries", () => {
    expect(groupPersonalMemoryRecallEntriesIntoBatches([])).toEqual([]);
  });
});
