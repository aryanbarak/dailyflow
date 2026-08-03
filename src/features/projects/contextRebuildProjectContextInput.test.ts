import { describe, expect, it } from "vitest";
import { buildProjectContext } from "./projectContextBuilder";
import {
  mapEvidenceSnapshotToProjectContextInput,
  mapProjectToSoftwareProject,
  mapSnapshotItemToProjectSource,
} from "./contextRebuildProjectContextInput";
import type { EvidenceSnapshot, EvidenceSnapshotItem } from "./evidenceSnapshotTypes";

const PROJECT = { id: "project-1", type: "software_project" as const, name: "SmartFlow" };

function snapshotItem(overrides: Partial<EvidenceSnapshotItem> = {}): EvidenceSnapshotItem {
  return {
    evidenceId: "evidence-1",
    sourceKind: "architecture_document",
    classification: "canonical_document_observation",
    title: "Project Domain",
    reference: "docs/architecture/project-domain.md",
    collectedAt: "2026-08-02T00:00:00.000Z",
    adapterIdentity: "repository-document-adapter",
    adapterVersion: "1.0.0",
    verificationMethod: "deterministic file read",
    contentHash: "a".repeat(64),
    textContent: "# Project Domain\n",
    mimeType: "text/markdown",
    byteLength: new TextEncoder().encode("# Project Domain\n").length,
    ...overrides,
  };
}

function snapshot(items: EvidenceSnapshotItem[] = [snapshotItem()]): EvidenceSnapshot {
  return {
    schemaVersion: "evidence-snapshot-v1",
    projectId: PROJECT.id,
    ownerId: "user-1",
    projectRecordVersion: 1,
    snapshotCreatedAt: "2026-08-03T00:00:00.000Z",
    items,
    excludedSupersededEvidenceIds: [],
    snapshotHash: "b".repeat(64),
  };
}

describe("mapProjectToSoftwareProject", () => {
  it("maps identity fields only, never fabricating a repository connection claim", () => {
    const result = mapProjectToSoftwareProject(PROJECT);
    expect(result).toEqual({ id: PROJECT.id, type: PROJECT.type, name: PROJECT.name });
    expect(result).not.toHaveProperty("repository");
  });
});

describe("mapSnapshotItemToProjectSource", () => {
  it("carries provenance forward losslessly, without interpretation", () => {
    const item = snapshotItem();
    const source = mapSnapshotItemToProjectSource(item);
    expect(source).toEqual({
      id: item.evidenceId,
      kind: item.sourceKind,
      title: item.title,
      reference: item.reference,
      retrievedAt: item.collectedAt,
    });
  });
});

describe("mapEvidenceSnapshotToProjectContextInput", () => {
  it("populates sources from the snapshot and leaves every derived-fact collection empty", () => {
    const input = mapEvidenceSnapshotToProjectContextInput(PROJECT, snapshot(), "2026-08-03T00:00:01.000Z");
    expect(input.project).toEqual({ id: PROJECT.id, type: PROJECT.type, name: PROJECT.name });
    expect(input.sources).toHaveLength(1);
    expect(input.objectives).toEqual([]);
    expect(input.milestones).toEqual([]);
    expect(input.decisions).toEqual([]);
    expect(input.capabilities).toEqual([]);
    expect(input.risks).toEqual([]);
    expect(input.candidateActions).toEqual([]);
    expect(input.generatedAt).toBe("2026-08-03T00:00:01.000Z");
  });

  it("proves the integration contract genuinely holds: real buildProjectContext accepts this mapping's output and produces a valid, evidence-backed (but fact-empty) context -- the mapping itself is the honestly-derivable half, never a claim of full understanding", () => {
    const input = mapEvidenceSnapshotToProjectContextInput(
      PROJECT,
      snapshot([snapshotItem({ evidenceId: "e-1" }), snapshotItem({ evidenceId: "e-2", reference: "docs/architecture/authority-model.md" })]),
      "2026-08-03T00:00:01.000Z",
    );
    const result = buildProjectContext(input);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.context.sources).toHaveLength(2);
    expect(result.context.objectives).toEqual([]);
    expect(result.context.acceptedDecisions).toEqual([]);
    expect(result.context.risks).toEqual([]);
    expect(result.context.candidateActions).toEqual([]);
    expect(result.context.currentObjective).toBeUndefined();
  });

  it("proves builder validation failure surfaces as a typed result, not a thrown exception, when the mapped input is malformed", () => {
    // An unsafe repository-document reference (path traversal) is exactly
    // what projectContextBuilder.ts's own validateSources rejects --
    // proving a malformed mapping output fails typed, not silently.
    const input = mapEvidenceSnapshotToProjectContextInput(
      PROJECT,
      snapshot([snapshotItem({ evidenceId: "e-1", reference: "../../etc/passwd" })]),
      "2026-08-03T00:00:01.000Z",
    );
    const result = buildProjectContext(input);
    expect(result.valid).toBe(false);
    if (result.valid === true) return;
    expect(result.errors.some((e) => e.code === "INVALID_SOURCE_REFERENCE")).toBe(true);
  });
});
