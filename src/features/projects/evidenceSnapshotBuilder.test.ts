import { describe, expect, it } from "vitest";
import { buildEvidenceSnapshot } from "./evidenceSnapshotBuilder";
import type { ProjectEvidence } from "./projectEvidenceTypes";
import type { ProjectEvidenceObservation } from "./projectEvidenceObservationTypes";

const PROJECT = { id: "project-1", ownerId: "user-1", version: 3 };

function evidence(overrides: Partial<ProjectEvidence> = {}): ProjectEvidence {
  return {
    id: "evidence-1",
    projectId: PROJECT.id,
    ownerId: PROJECT.ownerId,
    sourceKind: "architecture_document",
    classification: "canonical_document_observation",
    title: "Project Domain",
    reference: "docs/architecture/project-domain.md",
    collectedAt: "2026-08-02T00:00:00.000Z",
    adapterIdentity: "repository-document-adapter",
    adapterVersion: "1.0.0",
    verificationMethod: "deterministic file read",
    createdAt: "2026-08-02T00:00:01.000Z",
    ...overrides,
  };
}

function observation(overrides: Partial<ProjectEvidenceObservation> = {}): ProjectEvidenceObservation {
  const textContent = (overrides.textContent as string | undefined) ?? "# Project Domain\n";
  return {
    id: "observation-1",
    evidenceId: "evidence-1",
    projectId: PROJECT.id,
    ownerId: PROJECT.ownerId,
    payloadKind: "text",
    textContent,
    mimeType: "text/markdown",
    byteLength: new TextEncoder().encode(textContent).length,
    contentHash: "a".repeat(64),
    createdAt: "2026-08-02T00:00:01.000Z",
    ...overrides,
  };
}

function pair(evidenceOverrides: Partial<ProjectEvidence> = {}, observationOverrides: Partial<ProjectEvidenceObservation> = {}) {
  const ev = evidence(evidenceOverrides);
  const obs = observation({ evidenceId: ev.id, ...observationOverrides });
  return { evidence: ev, observation: obs };
}

describe("buildEvidenceSnapshot", () => {
  it("builds a snapshot from a single valid pair", async () => {
    const result = await buildEvidenceSnapshot(PROJECT, [pair()], "2026-08-03T00:00:00.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.snapshot.projectId).toBe(PROJECT.id);
    expect(result.snapshot.ownerId).toBe(PROJECT.ownerId);
    expect(result.snapshot.projectRecordVersion).toBe(PROJECT.version);
    expect(result.snapshot.snapshotCreatedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(result.snapshot.items).toHaveLength(1);
    expect(result.snapshot.items[0].evidenceId).toBe("evidence-1");
    expect(result.snapshot.excludedSupersededEvidenceIds).toEqual([]);
    expect(result.snapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("builds an empty, valid snapshot when there is no evidence yet -- not a failure", async () => {
    const result = await buildEvidenceSnapshot(PROJECT, [], "2026-08-03T00:00:00.000Z");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.snapshot.items).toEqual([]);
    expect(result.snapshot.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("deterministic ordering", () => {
    it("sorts by source kind, then reference, then collectedAt, then evidence id", async () => {
      const pairs = [
        pair({ id: "e-b", sourceKind: "adr", reference: "docs/decisions/adr/ADR-0002.md", collectedAt: "2026-08-01T00:00:00.000Z" }, { evidenceId: "e-b" }),
        pair({ id: "e-a", sourceKind: "adr", reference: "docs/decisions/adr/ADR-0001.md", collectedAt: "2026-08-01T00:00:00.000Z" }, { evidenceId: "e-a" }),
        pair({ id: "e-c", sourceKind: "architecture_document", reference: "docs/architecture/project-domain.md", collectedAt: "2026-08-01T00:00:00.000Z" }, { evidenceId: "e-c" }),
        pair({ id: "e-d", sourceKind: "adr", reference: "docs/decisions/adr/ADR-0001.md", collectedAt: "2026-08-02T00:00:00.000Z" }, { evidenceId: "e-d" }),
      ];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      // "adr" < "architecture_document" lexicographically, so both ADR
      // items sort before the architecture_document item; within "adr",
      // ADR-0001 sorts before ADR-0002, and the two ADR-0001 rows (same
      // source kind and reference) then tie-break on collectedAt.
      expect(result.snapshot.items.map((item) => item.evidenceId)).toEqual(["e-a", "e-d", "e-b", "e-c"]);
    });

    it("database return order does not affect the snapshot's item order or hash", async () => {
      const pairs = [
        pair({ id: "e-1", reference: "docs/architecture/a.md" }, { evidenceId: "e-1" }),
        pair({ id: "e-2", reference: "docs/architecture/b.md" }, { evidenceId: "e-2" }),
        pair({ id: "e-3", reference: "docs/architecture/c.md" }, { evidenceId: "e-3" }),
      ];
      const forward = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      const reversed = await buildEvidenceSnapshot(PROJECT, [...pairs].reverse(), "2026-08-03T00:00:00.000Z");
      expect(forward.valid).toBe(true);
      expect(reversed.valid).toBe(true);
      if (!forward.valid || !reversed.valid) return;
      expect(forward.snapshot.items.map((i) => i.evidenceId)).toEqual(reversed.snapshot.items.map((i) => i.evidenceId));
      expect(forward.snapshot.snapshotHash).toBe(reversed.snapshot.snapshotHash);
    });

    it("uses evidence id as the final deterministic tie-breaker when everything else is equal", async () => {
      const pairs = [
        pair({ id: "e-z" }, { evidenceId: "e-z" }),
        pair({ id: "e-a" }, { evidenceId: "e-a" }),
      ];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.snapshot.items.map((i) => i.evidenceId)).toEqual(["e-a", "e-z"]);
    });
  });

  describe("supersession", () => {
    it("excludes evidence explicitly superseded by another selected item, and records the exclusion", async () => {
      const pairs = [
        pair({ id: "old", reference: "docs/architecture/a.md" }, { evidenceId: "old" }),
        pair({ id: "new", reference: "docs/architecture/a.md", supersedesId: "old" }, { evidenceId: "new" }),
      ];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.snapshot.items.map((i) => i.evidenceId)).toEqual(["new"]);
      expect(result.snapshot.excludedSupersededEvidenceIds).toEqual(["old"]);
    });

    it("retains conflicting, non-superseding evidence side by side -- never silently picks a winner", async () => {
      const pairs = [
        pair({ id: "a", reference: "docs/architecture/a.md", collectedAt: "2026-08-01T00:00:00.000Z" }, { evidenceId: "a", textContent: "version one", contentHash: "a".repeat(64) }),
        pair({ id: "b", reference: "docs/architecture/a.md", collectedAt: "2026-08-02T00:00:00.000Z" }, { evidenceId: "b", textContent: "version two", contentHash: "b".repeat(64) }),
      ];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      // Neither timestamp nor array order picks a winner -- both survive.
      expect(result.snapshot.items.map((i) => i.evidenceId).sort()).toEqual(["a", "b"]);
    });

    it("does not resolve a supersedesId pointing outside the trusted pair set", async () => {
      const pairs = [pair({ id: "new", supersedesId: "not-in-this-set" }, { evidenceId: "new" })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.snapshot.items.map((i) => i.evidenceId)).toEqual(["new"]);
      expect(result.snapshot.excludedSupersededEvidenceIds).toEqual([]);
    });

    it("fails closed on evidence that claims to supersede itself", async () => {
      const pairs = [pair({ id: "self", supersedesId: "self" }, { evidenceId: "self" })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(false);
      if (result.valid === true) return;
      expect(result.errors.some((e) => e.code === "SNAPSHOT_VALIDATION_FAILED")).toBe(true);
    });
  });

  describe("fail-closed validation", () => {
    it("fails closed on an unsupported evidence classification", async () => {
      const pairs = [pair({ classification: "llm_inferred" as never })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(false);
      if (result.valid === true) return;
      expect(result.errors[0].code).toBe("UNSUPPORTED_EVIDENCE_CLASSIFICATION");
    });

    it("fails closed on an empty observation text content", async () => {
      const pairs = [pair({}, { textContent: "" })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(false);
      if (result.valid === true) return;
      expect(result.errors.some((e) => e.code === "MALFORMED_OBSERVATION")).toBe(true);
    });

    it("fails closed on an unsupported MIME type", async () => {
      const pairs = [pair({}, { mimeType: "application/json" as never })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(false);
      if (result.valid === true) return;
      expect(result.errors.some((e) => e.code === "MALFORMED_OBSERVATION")).toBe(true);
    });

    it("fails closed on a malformed content hash", async () => {
      const pairs = [pair({}, { contentHash: "not-a-hash" })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(false);
      if (result.valid === true) return;
      expect(result.errors.some((e) => e.code === "MALFORMED_OBSERVATION")).toBe(true);
    });

    it("fails closed when byteLength does not match the actual encoded text length", async () => {
      const pairs = [pair({}, { byteLength: 999999 })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(false);
      if (result.valid === true) return;
      expect(result.errors.some((e) => e.code === "MALFORMED_OBSERVATION")).toBe(true);
    });

    it("fails closed on a row outside the resolved owner/project scope, even if handed one", async () => {
      const pairs = [pair({ projectId: "some-other-project" })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(false);
      if (result.valid === true) return;
      expect(result.errors.some((e) => e.code === "SNAPSHOT_VALIDATION_FAILED")).toBe(true);
    });

    it("fails closed on a duplicate evidence id", async () => {
      const pairs = [pair({ id: "dup" }, { evidenceId: "dup" }), pair({ id: "dup" }, { evidenceId: "dup" })];
      const result = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(result.valid).toBe(false);
      if (result.valid === true) return;
      expect(result.errors.some((e) => e.code === "SNAPSHOT_VALIDATION_FAILED")).toBe(true);
    });
  });

  describe("snapshot identity hash", () => {
    it("produces the same hash for the same logical inputs", async () => {
      const pairs = [pair()];
      const first = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      const second = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      expect(first.valid && second.valid).toBe(true);
      if (!first.valid || !second.valid) return;
      expect(first.snapshot.snapshotHash).toBe(second.snapshot.snapshotHash);
    });

    it("changes the hash when a content hash changes", async () => {
      const base = [pair({ id: "e-1" }, { evidenceId: "e-1", contentHash: "a".repeat(64) })];
      const changed = [pair({ id: "e-1" }, { evidenceId: "e-1", contentHash: "b".repeat(64) })];
      const first = await buildEvidenceSnapshot(PROJECT, base, "2026-08-03T00:00:00.000Z");
      const second = await buildEvidenceSnapshot(PROJECT, changed, "2026-08-03T00:00:00.000Z");
      expect(first.valid && second.valid).toBe(true);
      if (!first.valid || !second.valid) return;
      expect(first.snapshot.snapshotHash).not.toBe(second.snapshot.snapshotHash);
    });

    it("changes the hash when the ProjectRecord version changes", async () => {
      const pairs = [pair()];
      const first = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      const second = await buildEvidenceSnapshot({ ...PROJECT, version: PROJECT.version + 1 }, pairs, "2026-08-03T00:00:00.000Z");
      expect(first.valid && second.valid).toBe(true);
      if (!first.valid || !second.valid) return;
      expect(first.snapshot.snapshotHash).not.toBe(second.snapshot.snapshotHash);
    });

    it("does not change the hash when only collectedAt differs -- collectedAt is not part of snapshot identity (ADR-0007's same content-identity lesson applied here)", async () => {
      const early = [pair({ id: "e-1", collectedAt: "2026-08-01T00:00:00.000Z" }, { evidenceId: "e-1" })];
      const late = [pair({ id: "e-1", collectedAt: "2026-09-01T00:00:00.000Z" }, { evidenceId: "e-1" })];
      const first = await buildEvidenceSnapshot(PROJECT, early, "2026-08-03T00:00:00.000Z");
      const second = await buildEvidenceSnapshot(PROJECT, late, "2026-08-03T00:00:00.000Z");
      expect(first.valid && second.valid).toBe(true);
      if (!first.valid || !second.valid) return;
      expect(first.snapshot.snapshotHash).toBe(second.snapshot.snapshotHash);
    });

    it("does not change the hash when only item array order differs (already covered by ordering above, restated for the hash specifically)", async () => {
      const pairs = [
        pair({ id: "e-1" }, { evidenceId: "e-1" }),
        pair({ id: "e-2" }, { evidenceId: "e-2" }),
      ];
      const forward = await buildEvidenceSnapshot(PROJECT, pairs, "2026-08-03T00:00:00.000Z");
      const reversed = await buildEvidenceSnapshot(PROJECT, [...pairs].reverse(), "2026-08-03T00:00:00.000Z");
      expect(forward.valid && reversed.valid).toBe(true);
      if (!forward.valid || !reversed.valid) return;
      expect(forward.snapshot.snapshotHash).toBe(reversed.snapshot.snapshotHash);
    });

    it("changes the hash when a supersession reference changes", async () => {
      const withoutSupersede = [
        pair({ id: "old" }, { evidenceId: "old" }),
        pair({ id: "new", reference: "docs/architecture/other.md" }, { evidenceId: "new" }),
      ];
      const withSupersede = [
        pair({ id: "old" }, { evidenceId: "old" }),
        pair({ id: "new", reference: "docs/architecture/other.md", supersedesId: "old" }, { evidenceId: "new" }),
      ];
      const first = await buildEvidenceSnapshot(PROJECT, withoutSupersede, "2026-08-03T00:00:00.000Z");
      const second = await buildEvidenceSnapshot(PROJECT, withSupersede, "2026-08-03T00:00:00.000Z");
      expect(first.valid && second.valid).toBe(true);
      if (!first.valid || !second.valid) return;
      expect(first.snapshot.snapshotHash).not.toBe(second.snapshot.snapshotHash);
    });
  });
});
