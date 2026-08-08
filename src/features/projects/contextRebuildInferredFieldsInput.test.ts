import { describe, expect, it } from "vitest";
import { mapInferredFieldsToProjectContextInputAdditions } from "./contextRebuildInferredFieldsInput";
import type { InferredProjectContextField } from "./inferredProjectContextFieldTypes";

function field(overrides: Partial<InferredProjectContextField> = {}): InferredProjectContextField {
  return {
    id: "field-1",
    ownerId: "user-1",
    projectId: "project-1",
    runId: "run-1",
    kind: "risk",
    content: { summary: "Data loss risk", severity: "high" },
    sourceEvidenceIds: ["evidence-1"],
    modelIdentity: "gemini-test",
    derivationVersion: "context-derivation-v1",
    confidence: "medium",
    status: "proposed",
    source: "model",
    contentFingerprint: "a".repeat(64),
    createdAt: "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("mapInferredFieldsToProjectContextInputAdditions", () => {
  it("maps a proposed field to inferred_unconfirmed and a confirmed field to user_declared", () => {
    const result = mapInferredFieldsToProjectContextInputAdditions([
      field({ status: "proposed" }),
      field({ id: "field-2", status: "user_confirmed" }),
      field({ id: "field-3", status: "user_corrected", source: "user" }),
    ]);
    expect(result.risks).toHaveLength(3);
    expect(result.risks[0].inferredProvenance?.stateCategory).toBe("inferred_unconfirmed");
    expect(result.risks[1].inferredProvenance?.stateCategory).toBe("user_declared");
    expect(result.risks[2].inferredProvenance?.stateCategory).toBe("user_declared");
  });

  it("excludes user_rejected and superseded fields entirely", () => {
    const result = mapInferredFieldsToProjectContextInputAdditions([
      field({ status: "user_rejected" }),
      field({ id: "field-2", status: "superseded" }),
    ]);
    expect(result.risks).toHaveLength(0);
  });

  it("carries sourceEvidenceIds through as sourceIds, and the field id through as the entity id", () => {
    const result = mapInferredFieldsToProjectContextInputAdditions([field({ sourceEvidenceIds: ["ev-1", "ev-2"] })]);
    expect(result.risks[0].id).toBe("field-1");
    expect(result.risks[0].sourceIds).toEqual(["ev-1", "ev-2"]);
  });

  it("maps every kind to its correct array with the right content shape", () => {
    const result = mapInferredFieldsToProjectContextInputAdditions([
      field({ id: "o1", kind: "objective", content: { summary: "Ship v1", status: "active" } }),
      field({ id: "m1", kind: "milestone", content: { title: "Beta", status: "active" } }),
      field({ id: "d1", kind: "decision", content: { title: "Use Postgres", status: "accepted" } }),
      field({ id: "c1", kind: "capability", content: { title: "Auth", status: "implemented" } }),
      field({ id: "r1", kind: "risk", content: { summary: "Data loss", severity: "high" } }),
      field({ id: "a1", kind: "candidate_action", content: { summary: "Add tests" } }),
    ]);
    expect(result.objectives[0]).toMatchObject({ id: "o1", summary: "Ship v1", status: "active" });
    expect(result.milestones[0]).toMatchObject({ id: "m1", title: "Beta", status: "active" });
    expect(result.decisions[0]).toMatchObject({ id: "d1", title: "Use Postgres", status: "accepted" });
    expect(result.capabilities[0]).toMatchObject({ id: "c1", title: "Auth", status: "implemented" });
    expect(result.risks[0]).toMatchObject({ id: "r1", summary: "Data loss", severity: "high" });
    expect(result.candidateActions[0]).toMatchObject({ id: "a1", kind: "candidate_action", authority: "non_authoritative", summary: "Add tests" });
  });

  it("includes derivationRunId in provenance for a model-sourced field, and omits it for a user-sourced one", () => {
    const result = mapInferredFieldsToProjectContextInputAdditions([
      field({ id: "m1", source: "model", runId: "run-1", status: "proposed" }),
      field({ id: "u1", source: "user", runId: undefined, status: "user_confirmed" }),
    ]);
    expect(result.risks[0].inferredProvenance?.derivationRunId).toBe("run-1");
    expect(result.risks[1].inferredProvenance?.derivationRunId).toBeUndefined();
  });

  it("returns empty arrays for every kind not present in the input", () => {
    const result = mapInferredFieldsToProjectContextInputAdditions([]);
    expect(result.objectives).toEqual([]);
    expect(result.milestones).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.capabilities).toEqual([]);
    expect(result.risks).toEqual([]);
    expect(result.candidateActions).toEqual([]);
  });
});
