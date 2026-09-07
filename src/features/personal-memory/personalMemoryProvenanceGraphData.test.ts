// CORE-W6 (2026-09-07, ADR-0023 SS5): the provenance graph's pure data
// builder. No DOM, no I/O -- resolved sources are passed in directly.
import { describe, expect, it } from "vitest";
import { buildProvenanceGraphData, type ResolvedProvenanceSources } from "./personalMemoryProvenanceGraphData";
import type { PersonalMemoryRecord } from "./personalMemoryRecordTypes";

function record(overrides: Partial<PersonalMemoryRecord> = {}): PersonalMemoryRecord {
  return {
    id: "record-1",
    ownerId: "user-1",
    kind: "preference",
    content: { summary: "Prefers async written updates" },
    provenance: { sourceKind: "chat_turn", sourceReferenceIds: ["msg-1"] },
    modelIdentity: "gemini",
    derivationVersion: "personal-memory-extraction-v1",
    confidence: "high",
    status: "user_confirmed",
    source: "model",
    contentFingerprint: "a".repeat(64),
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const EMPTY_RESOLVED: ResolvedProvenanceSources = { documentChunks: {}, chatTurns: {}, briefings: {} };

describe("buildProvenanceGraphData", () => {
  it("builds one memory node and one edge to a resolved chat_turn source", () => {
    const result = buildProvenanceGraphData(
      [record()],
      { ...EMPTY_RESOLVED, chatTurns: { "msg-1": { label: "every Monday at 9am works best", createdAt: "2026-08-30T00:00:00.000Z" } } },
    );
    expect(result.memoryNodes).toHaveLength(1);
    expect(result.sourceNodes).toEqual([{ id: "chat_turn:msg-1", sourceKind: "chat_turn", refId: "msg-1", label: "every Monday at 9am works best" }]);
    expect(result.edges).toEqual([{ recordId: "record-1", sourceNodeId: "chat_turn:msg-1" }]);
  });

  it("a document-sourced record whose chunk was deleted falls back to provenanceSnapshot, not dropped", () => {
    const documentRecord = record({
      provenance: { sourceKind: "document", sourceReferenceIds: ["chunk-1"] },
      provenanceSnapshot: [{ chunkId: "chunk-1", fileName: "resume.pdf", sectionLabel: "Work experience", contentExcerpt: "..." }],
    });
    const result = buildProvenanceGraphData([documentRecord], EMPTY_RESOLVED);
    expect(result.sourceNodes).toEqual([{ id: "document:chunk-1", sourceKind: "document", refId: "chunk-1", label: "resume.pdf — Work experience" }]);
    expect(result.edges).toHaveLength(1);
  });

  it("prefers the LIVE document chunk over the snapshot when both are present", () => {
    const documentRecord = record({
      provenance: { sourceKind: "document", sourceReferenceIds: ["chunk-1"] },
      provenanceSnapshot: [{ chunkId: "chunk-1", fileName: "stale.pdf", sectionLabel: "Old", contentExcerpt: "..." }],
    });
    const result = buildProvenanceGraphData(
      [documentRecord],
      { ...EMPTY_RESOLVED, documentChunks: { "chunk-1": { fileName: "resume.pdf", sectionLabel: "Work experience" } } },
    );
    expect(result.sourceNodes[0].label).toBe("resume.pdf — Work experience");
  });

  it("a record with no resolvable source (pruned chat_turn reference) renders with zero edges, not a crash", () => {
    const result = buildProvenanceGraphData([record({ provenance: { sourceKind: "chat_turn", sourceReferenceIds: ["gone"] } })], EMPTY_RESOLVED);
    expect(result.memoryNodes).toHaveLength(1);
    expect(result.sourceNodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("an explicit_user_statement record has no separate source to resolve -- zero edges, no crash", () => {
    const result = buildProvenanceGraphData(
      [record({ provenance: { sourceKind: "explicit_user_statement", sourceReferenceIds: ["self"] } })],
      EMPTY_RESOLVED,
    );
    expect(result.edges).toHaveLength(0);
  });

  it("two records citing the same source share one source node, not two duplicates", () => {
    const result = buildProvenanceGraphData(
      [record({ id: "record-1" }), record({ id: "record-2" })],
      { ...EMPTY_RESOLVED, chatTurns: { "msg-1": { label: "shared turn", createdAt: "2026-08-30T00:00:00.000Z" } } },
    );
    expect(result.sourceNodes).toHaveLength(1);
    expect(result.edges).toHaveLength(2);
  });
});
