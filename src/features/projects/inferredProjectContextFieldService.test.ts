import { describe, expect, it, vi } from "vitest";
import { createInferredProjectContextFieldService } from "./inferredProjectContextFieldService";
import { InferredContextFieldError } from "./inferredProjectContextFieldTypes";
import type { InferredProjectContextField } from "./inferredProjectContextFieldTypes";
import type { InferredProjectContextFieldRepository } from "./inferredProjectContextFieldRepository";
import type { ProjectRecordRepository } from "./projectRecordRepository";
import type { ProjectRecord } from "./projectRecordTypes";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";

function activeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: PROJECT_ID,
    ownerId: "user-1",
    type: "software_project",
    name: "SmartFlow",
    status: "active",
    enabledEvidenceSourceKinds: [],
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function proposedField(overrides: Partial<InferredProjectContextField> = {}): InferredProjectContextField {
  return {
    id: "field-1",
    ownerId: "user-1",
    projectId: PROJECT_ID,
    runId: "run-1",
    kind: "risk",
    content: { summary: "Data loss risk", severity: "high" },
    sourceEvidenceIds: [EVIDENCE_ID],
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

function fakeProjectRepository(project: ProjectRecord | null): ProjectRecordRepository {
  return {
    insert: vi.fn(),
    findById: vi.fn(async () => project),
    listByOwner: vi.fn(),
    updateConfig: vi.fn(),
    archiveActive: vi.fn(),
  };
}

function fakeInferredRepository(overrides: Partial<InferredProjectContextFieldRepository> = {}): InferredProjectContextFieldRepository {
  return {
    insert: vi.fn(),
    resolve: vi.fn(),
    findById: vi.fn(async () => null),
    listByProject: vi.fn(async () => []),
    createRun: vi.fn(),
    completeRun: vi.fn(),
    ...overrides,
  };
}

describe("createInferredProjectContextFieldService", () => {
  it("throws UNAUTHENTICATED when no owner is resolved, before touching any repository", async () => {
    const projectRepository = fakeProjectRepository(activeProject());
    const repository = fakeInferredRepository();
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => null });

    await expect(
      service.create({ projectId: PROJECT_ID, runId: "run-1", kind: "risk", content: { summary: "x", severity: "low" }, sourceEvidenceIds: [EVIDENCE_ID], modelIdentity: "m", derivationVersion: "v1", confidence: "low" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects create input that fails per-kind content validation before ever reaching the repository", async () => {
    const projectRepository = fakeProjectRepository(activeProject());
    const repository = fakeInferredRepository();
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });

    await expect(
      service.create({ projectId: PROJECT_ID, runId: "run-1", kind: "risk", content: { summary: "x", severity: "not-a-real-severity" }, sourceEvidenceIds: [EVIDENCE_ID], modelIdentity: "m", derivationVersion: "v1", confidence: "low" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects creation for an archived project without calling the repository", async () => {
    const projectRepository = fakeProjectRepository(activeProject({ status: "archived" }));
    const repository = fakeInferredRepository();
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });

    await expect(
      service.create({ projectId: PROJECT_ID, runId: "run-1", kind: "risk", content: { summary: "x", severity: "low" }, sourceEvidenceIds: [EVIDENCE_ID], modelIdentity: "m", derivationVersion: "v1", confidence: "low" }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("creates a valid field by delegating to the repository once ownership/archive checks pass", async () => {
    const projectRepository = fakeProjectRepository(activeProject());
    const repository = fakeInferredRepository({
      insert: vi.fn(async () => ({ outcome: "created" as const, field: proposedField() })),
    });
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });

    const result = await service.create({
      projectId: PROJECT_ID,
      runId: "run-1",
      kind: "risk",
      content: { summary: "Data loss risk", severity: "high" },
      sourceEvidenceIds: [EVIDENCE_ID],
      modelIdentity: "gemini-test",
      derivationVersion: "context-derivation-v1",
      confidence: "medium",
    });
    expect(result.outcome).toBe("created");
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });

  it("resolve: throws FIELD_NOT_FOUND for a missing or unowned field, never disclosing which case it is", async () => {
    const projectRepository = fakeProjectRepository(activeProject());
    const repository = fakeInferredRepository({ findById: vi.fn(async () => null) });
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });

    await expect(service.resolve({ fieldId: "missing", action: "confirm" })).rejects.toMatchObject({ code: "FIELD_NOT_FOUND" });
  });

  it("resolve: throws FIELD_NOT_PROPOSED when the field is already resolved", async () => {
    const projectRepository = fakeProjectRepository(activeProject());
    const repository = fakeInferredRepository({ findById: vi.fn(async () => proposedField({ status: "user_confirmed" })) });
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });

    await expect(service.resolve({ fieldId: "field-1", action: "reject" })).rejects.toMatchObject({ code: "FIELD_NOT_PROPOSED" });
  });

  it("resolve: a correction is validated against the ORIGINAL field's kind, and its fingerprint is computed before calling the repository", async () => {
    const projectRepository = fakeProjectRepository(activeProject());
    const resolveSpy = vi.fn(async (_input: unknown, _fingerprint?: string) => ({
      outcome: "user_corrected" as const,
      field: proposedField({ status: "user_confirmed", source: "user" }),
    }));
    const repository = fakeInferredRepository({ findById: vi.fn(async () => proposedField()), resolve: resolveSpy });
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });

    await service.resolve({ fieldId: "field-1", action: "correct", correctedContent: { summary: "Corrected risk", severity: "low" } });

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    const [, fingerprint] = resolveSpy.mock.calls[0];
    expect(typeof fingerprint).toBe("string");
    expect((fingerprint as string)).toHaveLength(64);
  });

  it("resolve: a correction with content that doesn't match the original field's kind shape is rejected before calling the repository", async () => {
    const projectRepository = fakeProjectRepository(activeProject());
    const repository = fakeInferredRepository({ findById: vi.fn(async () => proposedField({ kind: "risk" })) });
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });

    await expect(
      service.resolve({ fieldId: "field-1", action: "correct", correctedContent: { summary: "x", severity: "not-a-severity" } as never }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.resolve).not.toHaveBeenCalled();
  });

  it("listByProject: throws PROJECT_NOT_FOUND before listing when the project isn't owned", async () => {
    const projectRepository = fakeProjectRepository(null);
    const repository = fakeInferredRepository();
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });

    await expect(service.listByProject(PROJECT_ID)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(repository.listByProject).not.toHaveBeenCalled();
  });

  it("every thrown error is an InferredContextFieldError instance", async () => {
    const projectRepository = fakeProjectRepository(null);
    const repository = fakeInferredRepository();
    const service = createInferredProjectContextFieldService({ repository, projectRepository, resolveOwnerId: async () => "user-1" });
    await expect(service.listByProject(PROJECT_ID)).rejects.toBeInstanceOf(InferredContextFieldError);
  });
});
