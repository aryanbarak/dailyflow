// Standing guard against agent/worker/personal-memory-prompt-serialization.ts's
// duplicated cap algorithm and per-kind line templates drifting from the
// canonical frontend module -- the same pattern
// personalMemoryValidationEquivalence.test.ts already establishes for the
// sensitive-content heuristic. The two copies' section HEADER text is
// allowed to differ (see both files' headers); this test compares only the
// cap/ordering behavior and the per-record line text, which must not drift.

import { describe, expect, it } from "vitest";
import {
  formatConfirmedMemoryLine as tsFormatLine,
  selectBoundedConfirmedMemory as tsSelect,
} from "./personalMemoryPromptSerialization";
import {
  formatConfirmedMemoryLine as workerFormatLine,
  selectBoundedConfirmedMemory as workerSelect,
} from "../../../agent/worker/personal-memory-prompt-serialization";
import type { PersonalMemoryRecord } from "./personalMemoryRecordTypes";

function record(overrides: Partial<PersonalMemoryRecord> = {}): PersonalMemoryRecord {
  return {
    id: "record-1",
    ownerId: "owner-1",
    kind: "preference",
    content: { summary: "Prefers async written updates" },
    provenance: { sourceKind: "chat_turn", sourceReferenceIds: ["22222222-2222-4222-8222-222222222222"] },
    modelIdentity: "gemini",
    derivationVersion: "personal-memory-extraction-v1",
    confidence: "high",
    status: "user_confirmed",
    source: "model",
    contentFingerprint: "a".repeat(64),
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatConfirmedMemoryLine -- TS and Worker copies agree", () => {
  const fixtures: readonly PersonalMemoryRecord[] = [
    record({ kind: "preference", content: { summary: "Prefers async updates", strength: "strong" } }),
    record({ kind: "preference", content: { summary: "Prefers short meetings" } }),
    record({ kind: "goal", content: { summary: "Learn React Native", timeframe: "long_term" } }),
    record({ kind: "working_pattern", content: { summary: "Reviews PRs each morning", frequency: "daily" } }),
    record({ kind: "commitment", content: { summary: "Start running 3x/week", status: "active" } }),
    record({ kind: "personal_fact", content: { summary: "Prefers to be called Aryan", category: "identity" } }),
    record({ kind: "skill", content: { summary: "Learning algorithms", level: "beginner" } }),
  ];

  it.each(fixtures.map((r) => ({ label: `${r.kind}: ${JSON.stringify(r.content)}`, r })))(
    "$label",
    ({ r }) => {
      // Worker's ConfirmedPersonalMemoryRecord and PersonalMemoryRecord share
      // the fields formatConfirmedMemoryLine actually reads (kind, content).
      const workerShaped = { kind: r.kind, content: r.content as unknown as Record<string, unknown>, createdAt: r.createdAt };
      expect(tsFormatLine(r)).toBe(workerFormatLine(workerShaped));
    },
  );
});

describe("selectBoundedConfirmedMemory -- TS and Worker copies agree on caps and ordering", () => {
  it("selects the same subset, in the same order, for >10 records across kinds", () => {
    const records: PersonalMemoryRecord[] = [];
    const kinds: PersonalMemoryRecord["kind"][] = ["preference", "goal", "working_pattern", "commitment", "personal_fact", "skill"];
    let day = 1;
    for (const kind of kinds) {
      for (let i = 0; i < 4; i++) {
        records.push(
          record({
            id: `${kind}-${i}`,
            kind,
            content: kind === "commitment" ? { summary: `${kind} ${i}`, status: "active" } : { summary: `${kind} ${i}` },
            createdAt: `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`,
          }),
        );
        day += 1;
      }
    }

    const tsResult = tsSelect(records).map((r) => r.id);
    const workerShaped = records.map((r) => ({ kind: r.kind, content: r.content as unknown as Record<string, unknown>, createdAt: r.createdAt, id: r.id }));
    const workerResult = workerSelect(workerShaped).map((r) => (r as unknown as { id: string }).id);

    expect(tsResult).toEqual(workerResult);
    expect(tsResult).toHaveLength(10);
  });

  it("both copies agree on empty input", () => {
    expect(tsSelect([])).toEqual([]);
    expect(workerSelect([])).toEqual([]);
  });
});
