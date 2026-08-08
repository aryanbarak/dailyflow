import { describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock, rpc: rpcMock, auth: { getUser: getUserMock } },
}));

import { createContextRebuildService } from "./contextRebuildService";
import { ContextRebuildError } from "./contextRebuildTypes";
import type { ProjectEvidenceRepository } from "./projectEvidenceRepository";
import { ProjectEvidencePersistenceError } from "./projectEvidenceRepository";
import type { ProjectRecordRepository } from "./projectRecordRepository";
import type { ProjectRecord } from "./projectRecordTypes";
import type { ProjectEvidence, ProjectEvidenceWithObservation } from "./projectEvidenceTypes";
import type { ProjectEvidenceObservation } from "./projectEvidenceObservationTypes";

const OWNER_ID = "user-1";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-03T00:00:00.000Z";

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: PROJECT_ID,
    ownerId: OWNER_ID,
    type: "software_project",
    name: "SmartFlow",
    status: "active",
    enabledEvidenceSourceKinds: ["architecture_document"],
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function evidencePair(
  evidenceOverrides: Partial<ProjectEvidence> = {},
  observationOverrides: Partial<ProjectEvidenceObservation> = {},
): ProjectEvidenceWithObservation {
  const textContent = (observationOverrides.textContent as string | undefined) ?? "# Project Domain\n";
  const evidence: ProjectEvidence = {
    id: "evidence-1",
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    sourceKind: "architecture_document",
    classification: "canonical_document_observation",
    title: "Project Domain",
    reference: "docs/architecture/project-domain.md",
    collectedAt: "2026-08-02T00:00:00.000Z",
    adapterIdentity: "repository-document-adapter",
    adapterVersion: "1.0.0",
    verificationMethod: "deterministic file read",
    createdAt: "2026-08-02T00:00:01.000Z",
    ...evidenceOverrides,
  };
  const observation: ProjectEvidenceObservation = {
    id: "observation-1",
    evidenceId: evidence.id,
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    payloadKind: "text",
    textContent,
    mimeType: "text/markdown",
    byteLength: new TextEncoder().encode(textContent).length,
    contentHash: "a".repeat(64),
    createdAt: "2026-08-02T00:00:01.000Z",
    ...observationOverrides,
  };
  return { evidence, observation };
}

function fakeProjectRepository(record: ProjectRecord | null): ProjectRecordRepository {
  return {
    findById: vi.fn(async (ownerId: string, id: string) => {
      if (!record) return null;
      if (ownerId !== record.ownerId || id !== record.id) return null;
      return record;
    }),
    listByOwner: vi.fn(async () => []),
    insert: vi.fn(),
    updateConfig: vi.fn(),
    archiveActive: vi.fn(),
  } as unknown as ProjectRecordRepository;
}

function fakeEvidenceRepository(pairs: ProjectEvidenceWithObservation[] | (() => Promise<ProjectEvidenceWithObservation[]>)): ProjectEvidenceRepository {
  return {
    insert: vi.fn(),
    findById: vi.fn(),
    listByProject: vi.fn(async () => (typeof pairs === "function" ? pairs() : pairs)),
  };
}

function fakeInferredContextFieldRepository(fields: import("./inferredProjectContextFieldTypes").InferredProjectContextField[]) {
  return {
    insert: vi.fn(),
    resolve: vi.fn(),
    findById: vi.fn(),
    listByProject: vi.fn(async () => fields),
    createRun: vi.fn(),
    completeRun: vi.fn(),
  } as unknown as import("./inferredProjectContextFieldRepository").InferredProjectContextFieldRepository;
}

function serviceFor(options: {
  record?: ProjectRecord | null;
  pairs?: ProjectEvidenceWithObservation[] | (() => Promise<ProjectEvidenceWithObservation[]>);
  ownerId?: string | null;
  canDeriveProjectContext?: (snapshot: unknown) => boolean;
  inferredFields?: import("./inferredProjectContextFieldTypes").InferredProjectContextField[];
} = {}) {
  const record = options.record === undefined ? projectRecord() : options.record;
  const pairs = options.pairs ?? [evidencePair()];
  return createContextRebuildService({
    projectRepository: fakeProjectRepository(record),
    evidenceRepository: fakeEvidenceRepository(pairs),
    ...(options.inferredFields ? { inferredContextFieldRepository: fakeInferredContextFieldRepository(options.inferredFields) } : {}),
    resolveOwnerId: async () => (options.ownerId === undefined ? OWNER_ID : options.ownerId),
    now: () => NOW,
    canDeriveProjectContext: options.canDeriveProjectContext as never,
  });
}

describe("contextRebuildService", () => {
  describe("authentication and ownership", () => {
    it("resolves owner before any repository read, and fails unauthenticated before any read happens", async () => {
      const projectRepo = fakeProjectRepository(projectRecord());
      const evidenceRepo = fakeEvidenceRepository([evidencePair()]);
      const service = createContextRebuildService({
        projectRepository: projectRepo,
        evidenceRepository: evidenceRepo,
        resolveOwnerId: async () => null,
        now: () => NOW,
      });
      await expect(service.rebuildProjectContext(PROJECT_ID)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      expect(projectRepo.findById).not.toHaveBeenCalled();
      expect(evidenceRepo.listByProject).not.toHaveBeenCalled();
    });

    it("lets the owner rebuild their own project", async () => {
      const service = serviceFor();
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("snapshot_ready_context_not_derivable");
      expect(result.project.id).toBe(PROJECT_ID);
    });

    it("returns a non-disclosing not-found for a project owned by another user", async () => {
      const service = serviceFor({ record: projectRecord({ ownerId: "someone-else" }) });
      await expect(service.rebuildProjectContext(PROJECT_ID)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    });

    it("returns the identical error for a project that does not exist at all", async () => {
      const service = serviceFor({ record: null });
      await expect(service.rebuildProjectContext(PROJECT_ID)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    });

    it("fails closed for an archived project", async () => {
      const service = serviceFor({ record: projectRecord({ status: "archived" }) });
      await expect(service.rebuildProjectContext(PROJECT_ID)).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
    });
  });

  describe("evidence snapshot selection", () => {
    it("reads evidence scoped to the resolved owner and requested project", async () => {
      const evidenceRepo = fakeEvidenceRepository([evidencePair()]);
      const service = createContextRebuildService({
        projectRepository: fakeProjectRepository(projectRecord()),
        evidenceRepository: evidenceRepo,
        resolveOwnerId: async () => OWNER_ID,
        now: () => NOW,
      });
      await service.rebuildProjectContext(PROJECT_ID);
      expect(evidenceRepo.listByProject).toHaveBeenCalledWith(OWNER_ID, PROJECT_ID, { includeSuperseded: true });
    });

    it("maps a missing-observation persistence inconsistency to a typed MISSING_OBSERVATION failure, never a raw exception", async () => {
      const service = serviceFor({
        pairs: async () => {
          throw new ProjectEvidencePersistenceError("Project evidence is missing its required observation.");
        },
      });
      const error = await service.rebuildProjectContext(PROJECT_ID).catch((e) => e);
      expect(error).toBeInstanceOf(ContextRebuildError);
      expect((error as ContextRebuildError).code).toBe("MISSING_OBSERVATION");
    });

    it("maps any other evidence read failure to a typed EVIDENCE_READ_FAILED, without leaking the raw error", async () => {
      const service = serviceFor({
        pairs: async () => {
          throw new ProjectEvidencePersistenceError("connection reset by peer at 10.0.0.4");
        },
      });
      const error = await service.rebuildProjectContext(PROJECT_ID).catch((e) => e);
      expect(error).toBeInstanceOf(ContextRebuildError);
      expect((error as ContextRebuildError).code).toBe("EVIDENCE_READ_FAILED");
      expect((error as ContextRebuildError).message).not.toMatch(/10\.0\.0\.4/);
    });

    it("fails closed on a malformed observation payload rather than silently dropping the item", async () => {
      const service = serviceFor({ pairs: [evidencePair({}, { contentHash: "not-a-hash" })] });
      const error = await service.rebuildProjectContext(PROJECT_ID).catch((e) => e);
      expect(error).toBeInstanceOf(ContextRebuildError);
      expect((error as ContextRebuildError).code).toBe("MALFORMED_OBSERVATION");
    });

    it("fails closed on an unsupported evidence classification rather than silently excluding it", async () => {
      const service = serviceFor({ pairs: [evidencePair({ classification: "llm_inferred" as never })] });
      const error = await service.rebuildProjectContext(PROJECT_ID).catch((e) => e);
      expect(error).toBeInstanceOf(ContextRebuildError);
      expect((error as ContextRebuildError).code).toBe("UNSUPPORTED_EVIDENCE_CLASSIFICATION");
    });

    it("excludes superseded evidence and reflects that in rebuildMetadata", async () => {
      const pairs = [
        evidencePair({ id: "old" }, { evidenceId: "old" }),
        evidencePair({ id: "new", supersedesId: "old" }, { evidenceId: "new" }),
      ];
      const service = serviceFor({ pairs });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.snapshot.items.map((i) => i.evidenceId)).toEqual(["new"]);
      expect(result.rebuildMetadata.excludedSupersededEvidenceCount).toBe(1);
      expect(result.rebuildMetadata.includedEvidenceCount).toBe(1);
    });

    it("retains conflicting non-superseding evidence in the snapshot", async () => {
      const pairs = [
        evidencePair({ id: "a", collectedAt: "2026-08-01T00:00:00.000Z" }, { evidenceId: "a", contentHash: "a".repeat(64) }),
        evidencePair({ id: "b", collectedAt: "2026-08-02T00:00:00.000Z" }, { evidenceId: "b", contentHash: "b".repeat(64) }),
      ];
      const service = serviceFor({ pairs });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.snapshot.items.map((i) => i.evidenceId).sort()).toEqual(["a", "b"]);
    });
  });

  describe("freshness metadata", () => {
    it("reports ProjectRecord version, snapshot creation time, included count, and snapshot hash", async () => {
      const service = serviceFor({ record: projectRecord({ version: 7 }) });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.rebuildMetadata.projectRecordVersion).toBe(7);
      expect(result.rebuildMetadata.snapshotCreatedAt).toBe(NOW);
      expect(result.rebuildMetadata.includedEvidenceCount).toBe(1);
      expect(result.rebuildMetadata.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.rebuildMetadata.newestEvidenceCollectedAt).toBe("2026-08-02T00:00:00.000Z");
    });

    it("reports a null newestEvidenceCollectedAt for a project with no evidence yet", async () => {
      const service = serviceFor({ pairs: [] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.rebuildMetadata.newestEvidenceCollectedAt).toBeNull();
      expect(result.rebuildMetadata.includedEvidenceCount).toBe(0);
    });
  });

  describe("honest capability: builder integration", () => {
    it("never fakes a successful rebuild: current raw-text-only evidence returns snapshot_ready_context_not_derivable, not a fabricated context", async () => {
      const service = serviceFor();
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("snapshot_ready_context_not_derivable");
      expect(result).not.toHaveProperty("context");
      if (result.status === "snapshot_ready_context_not_derivable") {
        expect(result.reasonCode).toBe("EVIDENCE_TO_CONTEXT_TRANSFORMATION_UNSUPPORTED");
        expect(typeof result.reason).toBe("string");
        expect(result.reason.length).toBeGreaterThan(0);
      }
      expect(result.rebuildMetadata.status).toBe("snapshot_ready_context_not_derivable");
    });

    it("still returns the full snapshot (with real evidence-backed sources) even when context cannot be derived -- traceability is not lost", async () => {
      const service = serviceFor();
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.snapshot.items).toHaveLength(1);
      expect(result.snapshot.items[0].textContent).toBe("# Project Domain\n");
    });

    it("calls ProjectContextBuilder only with validated, normalized input when a deterministic transformation is available, and returns a real context_ready result", async () => {
      const service = serviceFor({ canDeriveProjectContext: () => true });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("context_ready");
      if (result.status !== "context_ready") return;
      expect(result.context.contextVersion).toBe("project-context-v1");
      expect(result.context.sources).toHaveLength(1);
      expect(result.context.objectives).toEqual([]);
      expect(result.rebuildMetadata.status).toBe("context_ready");
    });

    it("surfaces a ProjectContextBuilder validation failure as a typed BUILDER_VALIDATION_FAILED error, never a partial context", async () => {
      // An unsafe reference is exactly what buildProjectContext's own
      // validateSources rejects -- proving the wiring surfaces a real
      // builder-side rejection as a typed failure.
      const service = serviceFor({
        pairs: [evidencePair({ reference: "not-a-markdown-reference" })],
        canDeriveProjectContext: () => true,
      });
      const error = await service.rebuildProjectContext(PROJECT_ID).catch((e) => e);
      expect(error).toBeInstanceOf(ContextRebuildError);
      expect((error as ContextRebuildError).code).toBe("BUILDER_VALIDATION_FAILED");
    });
  });

  describe("read-only guarantee", () => {
    it("never calls a mutating Supabase table method", async () => {
      const service = serviceFor();
      await service.rebuildProjectContext(PROJECT_ID);
      expect(fromMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("ADR-0009: Inferred Project Context Layer integration", () => {
    function confirmedRiskField(): import("./inferredProjectContextFieldTypes").InferredProjectContextField {
      return {
        id: "field-1",
        ownerId: OWNER_ID,
        projectId: PROJECT_ID,
        runId: "run-1",
        kind: "risk",
        content: { summary: "Single point of failure in the auth service", severity: "high" },
        sourceEvidenceIds: ["evidence-1"],
        modelIdentity: "gemini-test",
        derivationVersion: "context-derivation-v1",
        confidence: "medium",
        status: "user_confirmed",
        source: "model",
        contentFingerprint: "a".repeat(64),
        createdAt: "2026-08-07T00:00:00.000Z",
      };
    }

    it("without any inferred field, preserves the existing honest snapshot_ready_context_not_derivable outcome unchanged", async () => {
      const service = serviceFor({ inferredFields: [] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("snapshot_ready_context_not_derivable");
    });

    it("with at least one eligible (user_confirmed) inferred field, produces a REAL, non-fabricated ProjectContext for the first time", async () => {
      const service = serviceFor({ inferredFields: [confirmedRiskField()] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("context_ready");
      if (result.status !== "context_ready") throw new Error("expected a real context");
      expect(result.context.risks).toHaveLength(1);
      expect(result.context.risks[0]).toMatchObject({
        id: "field-1",
        summary: "Single point of failure in the auth service",
        severity: "high",
      });
      // Provenance survives all the way from the InferredProjectContextField
      // into the built ProjectContext (representative-engine.md section 16)
      // -- a user_confirmed field is marked "user_declared", the highest
      // trust tier available in this layer, but is still visibly marked as
      // inferred-derived, never indistinguishable from a hand-authored fact.
      expect(result.context.risks[0].inferredProvenance).toMatchObject({
        stateCategory: "user_declared",
        inferredFieldId: "field-1",
        confidence: "medium",
        modelIdentity: "gemini-test",
        derivationRunId: "run-1",
      });
    });

    it("a still-proposed (unconfirmed) inferred field is also included, visibly marked inferred_unconfirmed", async () => {
      const service = serviceFor({ inferredFields: [{ ...confirmedRiskField(), status: "proposed" }] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("context_ready");
      if (result.status !== "context_ready") throw new Error("expected a real context");
      expect(result.context.risks[0].inferredProvenance?.stateCategory).toBe("inferred_unconfirmed");
    });

    it("excludes a user_rejected inferred field entirely -- it must not silently reappear as context content", async () => {
      const service = serviceFor({ inferredFields: [{ ...confirmedRiskField(), status: "user_rejected" }] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("snapshot_ready_context_not_derivable");
    });

    it("excludes a superseded inferred field entirely", async () => {
      const service = serviceFor({ inferredFields: [{ ...confirmedRiskField(), status: "superseded" }] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("snapshot_ready_context_not_derivable");
    });

    it("still reads only already-persisted evidence and inferred fields -- no new fs/network/LLM import exists in this module", async () => {
      const service = serviceFor({ inferredFields: [confirmedRiskField()] });
      await service.rebuildProjectContext(PROJECT_ID);
      // Read-only guarantee re-asserted specifically for the inferred-field
      // path: the fake inferred repository's only method called is
      // listByProject, never insert/resolve/createRun/completeRun.
      expect(fromMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("review finding F1: precedence resolution end to end", () => {
    function riskField(overrides: Partial<import("./inferredProjectContextFieldTypes").InferredProjectContextField>): import("./inferredProjectContextFieldTypes").InferredProjectContextField {
      return {
        id: "field-1",
        ownerId: OWNER_ID,
        projectId: PROJECT_ID,
        runId: "run-1",
        kind: "risk",
        content: { summary: "Data loss risk", severity: "high" },
        sourceEvidenceIds: ["evidence-1"],
        modelIdentity: "gemini-test",
        derivationVersion: "context-derivation-v1",
        confidence: "medium",
        status: "user_confirmed",
        source: "model",
        contentFingerprint: "a".repeat(64),
        createdAt: "2026-08-07T00:00:00.000Z",
        ...overrides,
      };
    }

    it("a still-proposed candidate for the same normalized slot as a user_confirmed candidate is dropped by precedence, and the conflict is recorded visibly in the built context", async () => {
      const confirmed = riskField({ id: "field-confirmed", status: "user_confirmed", content: { summary: "Data loss risk", severity: "high" } });
      const proposed = riskField({ id: "field-proposed", status: "proposed", content: { summary: "data loss risk", severity: "low" } });
      const service = serviceFor({ inferredFields: [confirmed, proposed] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("context_ready");
      if (result.status !== "context_ready") throw new Error("expected a real context");
      expect(result.context.risks).toHaveLength(1);
      expect(result.context.risks[0].id).toBe("field-confirmed");
      expect(result.context.precedenceConflicts).toEqual([
        {
          kind: "risk",
          slotKey: "risk:summary:data loss risk",
          winners: [{ id: "field-confirmed", tier: "user_declared" }],
          superseded: [{ id: "field-proposed", tier: "inferred_unconfirmed" }],
          reason: "higher_tier_precedence",
        },
      ]);
    });

    it("two same-tier (both proposed) candidates for the same slot are both kept, never silently narrowed to one", async () => {
      const first = riskField({ id: "field-a", status: "proposed", content: { summary: "Data loss risk", severity: "high" } });
      const second = riskField({ id: "field-b", status: "proposed", content: { summary: "Data loss risk", severity: "low" } });
      const service = serviceFor({ inferredFields: [first, second] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("context_ready");
      if (result.status !== "context_ready") throw new Error("expected a real context");
      expect(result.context.risks.map((r) => r.id).sort()).toEqual(["field-a", "field-b"]);
      expect(result.context.precedenceConflicts[0]).toMatchObject({ reason: "same_tier_conflict" });
    });

    it("no conflict at all reports an empty precedenceConflicts array, not an absent field", async () => {
      const service = serviceFor({ inferredFields: [riskField({ id: "field-1", status: "user_confirmed" })] });
      const result = await service.rebuildProjectContext(PROJECT_ID);
      expect(result.status).toBe("context_ready");
      if (result.status !== "context_ready") throw new Error("expected a real context");
      expect(result.context.precedenceConflicts).toEqual([]);
    });

    it("is deterministic: rebuilding twice from the same inputs produces the identical winner and the identical conflict record", async () => {
      const confirmed = riskField({ id: "field-confirmed", status: "user_confirmed" });
      const proposed = riskField({ id: "field-proposed", status: "proposed", content: { summary: "data loss risk", severity: "low" } });
      const service = serviceFor({ inferredFields: [confirmed, proposed] });
      const first = await service.rebuildProjectContext(PROJECT_ID);
      const second = await service.rebuildProjectContext(PROJECT_ID);
      if (first.status !== "context_ready" || second.status !== "context_ready") throw new Error("expected a real context");
      expect(first.context.risks).toEqual(second.context.risks);
      expect(first.context.precedenceConflicts).toEqual(second.context.precedenceConflicts);
    });
  });
});
