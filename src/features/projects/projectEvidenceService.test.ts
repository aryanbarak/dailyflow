import { beforeEach, describe, expect, it, vi } from "vitest";

// projectEvidenceService.ts imports the real Supabase client module (for its
// default owner-id resolver). Every test here injects its own
// `resolveOwnerId`, so the real client is never called -- but constructing
// it eagerly at import time still runs createClient(...) with a browser
// `localStorage` that does not exist in the test environment. Mocking the
// module out, exactly as projectRecordService.test.ts already does, avoids
// that unrelated import-time side effect.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: vi.fn() } },
}));

import { createProjectEvidenceService } from "./projectEvidenceService";
import type { ProjectEvidenceRepository } from "./projectEvidenceRepository";
import { ProjectEvidenceError, type CreateProjectEvidenceResult, type ProjectEvidenceWithObservation } from "./projectEvidenceTypes";
import type { ProjectRecord } from "./projectRecordTypes";
import type { ProjectRecordRepository } from "./projectRecordRepository";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_A,
    sourceKind: "architecture_document",
    classification: "canonical_document_observation",
    title: "Project Domain",
    reference: "docs/architecture/project-domain.md",
    collectedAt: "2026-08-02T00:00:00.000Z",
    adapterIdentity: "repository-document-adapter",
    adapterVersion: "1.0.0",
    verificationMethod: "deterministic file read",
    observation: {
      textContent: "# Project Domain\n",
      mimeType: "text/markdown",
    },
    ...overrides,
  };
}

function createFakeProjectRecordRepository(): ProjectRecordRepository & { seed(record: Partial<ProjectRecord> & { id: string; ownerId: string }): void } {
  const rows = new Map<string, ProjectRecord>();
  return {
    seed(record) {
      rows.set(record.id, {
        type: "software_project",
        name: "Project",
        status: "active",
        enabledEvidenceSourceKinds: ["architecture_document", "adr"],
        version: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...record,
      } as ProjectRecord);
    },
    async insert() {
      throw new Error("not used by these tests");
    },
    async findById(ownerId, id) {
      const record = rows.get(id);
      return record && record.ownerId === ownerId ? record : null;
    },
    async listByOwner() {
      throw new Error("not used by these tests");
    },
    async updateConfig() {
      throw new Error("not used by these tests");
    },
    async archiveActive() {
      throw new Error("not used by these tests");
    },
  };
}

/**
 * Fakes the real `create_project_evidence_with_observation` transaction's
 * observable behavior: content-hash-based duplicate identity (never
 * `collectedAt`-based), and a graceful `{ outcome: "unchanged" }` result on
 * a fingerprint match rather than a thrown conflict -- mirroring ADR-0007
 * exactly, not the pre-ADR-0007 Slice 4B behavior.
 */
function createFakeEvidenceRepository(): ProjectEvidenceRepository & { rows: Map<string, ProjectEvidenceWithObservation> } {
  const rows = new Map<string, ProjectEvidenceWithObservation>();
  const byFingerprint = new Map<string, string>();
  let nextId = 1;

  function fingerprintFor(projectId: string, input: { sourceKind: string; reference: string; adapterIdentity: string; adapterVersion: string; observation: { textContent: string } }) {
    return [projectId, input.sourceKind, input.reference, input.observation.textContent, input.adapterIdentity, input.adapterVersion].join("|");
  }

  return {
    rows,
    async insert(ownerId, projectId, input): Promise<CreateProjectEvidenceResult> {
      const fingerprint = fingerprintFor(projectId, input);
      const existingId = byFingerprint.get(fingerprint);
      if (existingId) {
        const existing = rows.get(existingId)!;
        return { outcome: "unchanged", evidence: existing.evidence, observation: existing.observation };
      }

      // UUID-shaped so tests can pass a created record's own id back in as a
      // `supersedesId` and have it survive real UUID-shape validation,
      // matching production's `gen_random_uuid()`-generated ids.
      const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
      const evidence: ProjectEvidenceWithObservation["evidence"] = {
        id,
        projectId,
        ownerId,
        sourceKind: input.sourceKind,
        classification: input.classification,
        title: input.title,
        reference: input.reference,
        collectedAt: input.collectedAt,
        adapterIdentity: input.adapterIdentity,
        adapterVersion: input.adapterVersion,
        verificationMethod: input.verificationMethod,
        createdAt: "2026-08-02T00:00:02.000Z",
      };
      if (input.sourceRevision !== undefined) evidence.sourceRevision = input.sourceRevision;
      if (input.confidence !== undefined) evidence.confidence = input.confidence;
      if (input.uncertainty !== undefined) evidence.uncertainty = input.uncertainty;
      if (input.notes !== undefined) evidence.notes = input.notes;
      if (input.supersedesId !== undefined) evidence.supersedesId = input.supersedesId;
      if (input.acquisitionAttemptId !== undefined) evidence.acquisitionAttemptId = input.acquisitionAttemptId;

      const observationId = `00000000-0000-4000-9000-${String(nextId).padStart(12, "0")}`;
      const observation: ProjectEvidenceWithObservation["observation"] = {
        id: observationId,
        evidenceId: id,
        projectId,
        ownerId,
        payloadKind: "text",
        textContent: input.observation.textContent,
        mimeType: input.observation.mimeType,
        byteLength: input.observation.byteLength,
        contentHash: `fake-hash-${input.observation.textContent}`,
        createdAt: "2026-08-02T00:00:02.000Z",
      };
      if (input.observation.gitRevision !== undefined) observation.gitRevision = input.observation.gitRevision;

      const pair: ProjectEvidenceWithObservation = { evidence, observation };
      rows.set(id, pair);
      byFingerprint.set(fingerprint, id);
      return { outcome: "created", evidence, observation };
    },
    async findById(ownerId, id) {
      const pair = rows.get(id);
      return pair && pair.evidence.ownerId === ownerId ? pair : null;
    },
    async listByProject(ownerId, projectId, options) {
      const owned = [...rows.values()].filter((pair) => pair.evidence.ownerId === ownerId && pair.evidence.projectId === projectId);
      if (options.includeSuperseded) return owned;
      const supersededIds = new Set(
        owned.map((pair) => pair.evidence.supersedesId).filter((id): id is string => Boolean(id)),
      );
      return owned.filter((pair) => !supersededIds.has(pair.evidence.id));
    },
  };
}

describe("projectEvidenceService", () => {
  let evidenceRepository: ReturnType<typeof createFakeEvidenceRepository>;
  let projectRepository: ReturnType<typeof createFakeProjectRecordRepository>;

  beforeEach(() => {
    evidenceRepository = createFakeEvidenceRepository();
    projectRepository = createFakeProjectRecordRepository();
    projectRepository.seed({ id: PROJECT_A, ownerId: "user-1" });
    projectRepository.seed({ id: PROJECT_B, ownerId: "user-2" });
  });

  function serviceFor(ownerId: string | null) {
    return createProjectEvidenceService({
      repository: evidenceRepository,
      projectRepository,
      resolveOwnerId: async () => ownerId,
    });
  }

  describe("create", () => {
    it("assigns the trusted resolved owner, never a caller-supplied one", async () => {
      const service = serviceFor("user-1");
      const result = await service.create(validInput());
      expect(result.outcome).toBe("created");
      expect(result.evidence.ownerId).toBe("user-1");
      expect(result.observation.ownerId).toBe("user-1");
    });

    it("rejects an attempt to smuggle an owner id in the input rather than silently dropping it", async () => {
      const service = serviceFor("user-1");
      await expect(service.create(validInput({ ownerId: "attacker" }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(evidenceRepository.rows.size).toBe(0);
    });

    it("rejects an attempt to supply a client-chosen id, so self-supersession has no path to occur", async () => {
      const service = serviceFor("user-1");
      await expect(service.create(validInput({ id: "attacker-chosen-id" }))).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    });

    it("rejects when unauthenticated, before touching either repository", async () => {
      const service = serviceFor(null);
      await expect(service.create(validInput())).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      expect(evidenceRepository.rows.size).toBe(0);
    });

    it("rejects missing or invalid observation payload before persistence", async () => {
      const service = serviceFor("user-1");
      const raw = validInput();
      delete (raw as Record<string, unknown>).observation;
      await expect(service.create(raw)).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(evidenceRepository.rows.size).toBe(0);
    });

    it("verifies the owning project exists and belongs to the caller", async () => {
      const service = serviceFor("user-1");
      const result = await service.create(validInput({ projectId: PROJECT_A }));
      expect(result.evidence.projectId).toBe(PROJECT_A);
    });

    it("rejects evidence for a project owned by another user without confirming it exists", async () => {
      const service = serviceFor("user-1");
      await expect(service.create(validInput({ projectId: PROJECT_B }))).rejects.toMatchObject({
        code: "PROJECT_NOT_FOUND",
      });
    });

    it("rejects evidence for a project that does not exist at all, with the same error as a cross-user project", async () => {
      const service = serviceFor("user-1");
      await expect(
        service.create(validInput({ projectId: "99999999-9999-4999-8999-999999999999" })),
      ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    });

    it("rejects evidence for an archived project", async () => {
      projectRepository.seed({ id: PROJECT_A, ownerId: "user-1", status: "archived" });
      const service = serviceFor("user-1");
      await expect(service.create(validInput())).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
    });

    it("rejects a source kind that is not enabled on the project's configuration", async () => {
      projectRepository.seed({ id: PROJECT_A, ownerId: "user-1", enabledEvidenceSourceKinds: ["adr"] });
      const service = serviceFor("user-1");
      await expect(service.create(validInput({ sourceKind: "architecture_document" }))).rejects.toMatchObject({
        code: "SOURCE_KIND_NOT_ENABLED",
      });
    });

    it("rejects a supersedesId that does not reference any existing evidence", async () => {
      const service = serviceFor("user-1");
      await expect(
        service.create(validInput({ supersedesId: "99999999-9999-4999-8999-999999999999" })),
      ).rejects.toMatchObject({ code: "SUPERSEDED_EVIDENCE_NOT_FOUND" });
    });

    it("accepts a supersedesId that references existing evidence in the same project", async () => {
      const service = serviceFor("user-1");
      const original = await service.create(validInput());
      const superseding = await service.create(
        validInput({
          supersedesId: original.evidence.id,
          title: "Renamed",
          collectedAt: "2026-08-03T00:00:00.000Z",
          observation: { textContent: "# Project Domain (renamed)\n", mimeType: "text/markdown" },
        }),
      );
      expect(superseding.outcome).toBe("created");
      expect(superseding.evidence.supersedesId).toBe(original.evidence.id);
    });

    it("rejects cross-project supersession, with the same error as a nonexistent reference", async () => {
      const serviceA = serviceFor("user-1");
      const serviceB = serviceFor("user-2");
      const evidenceInB = await serviceB.create(validInput({ projectId: PROJECT_B }));

      let caughtA: unknown;
      try {
        await serviceA.create(validInput({ projectId: PROJECT_A, supersedesId: evidenceInB.evidence.id }));
      } catch (error) {
        caughtA = error;
      }
      let caughtNonexistent: unknown;
      try {
        await serviceA.create(validInput({ projectId: PROJECT_A, supersedesId: "99999999-9999-4999-8999-999999999999" }));
      } catch (error) {
        caughtNonexistent = error;
      }
      expect((caughtA as ProjectEvidenceError).code).toBe("SUPERSEDED_EVIDENCE_NOT_FOUND");
      expect((caughtNonexistent as ProjectEvidenceError).code).toBe("SUPERSEDED_EVIDENCE_NOT_FOUND");
    });

    it("returns an 'unchanged' outcome (never an error) for an exact resubmission of the same content", async () => {
      const service = serviceFor("user-1");
      const first = await service.create(validInput());
      const second = await service.create(validInput());
      expect(second.outcome).toBe("unchanged");
      expect(second.evidence.id).toBe(first.evidence.id);
      expect(evidenceRepository.rows.size).toBe(1);
    });

    it("treats unchanged content at a later collectedAt as unchanged, not a new record -- collectedAt must not participate in duplicate identity (ADR-0007)", async () => {
      const service = serviceFor("user-1");
      const first = await service.create(validInput());
      const second = await service.create(validInput({ collectedAt: "2026-09-01T00:00:00.000Z" }));
      expect(second.outcome).toBe("unchanged");
      expect(second.evidence.id).toBe(first.evidence.id);
      expect(evidenceRepository.rows.size).toBe(1);
    });

    it("creates a new record when content genuinely changes at the same reference", async () => {
      const service = serviceFor("user-1");
      const first = await service.create(validInput());
      const second = await service.create(
        validInput({ observation: { textContent: "# Project Domain\n\nUpdated.\n", mimeType: "text/markdown" } }),
      );
      expect(second.outcome).toBe("created");
      expect(second.evidence.id).not.toBe(first.evidence.id);
    });

    it("treats identical content at a different reference as a distinct evidence item", async () => {
      const service = serviceFor("user-1");
      const first = await service.create(validInput({ reference: "docs/architecture/project-domain.md" }));
      const second = await service.create(validInput({ reference: "docs/architecture/authority-model.md" }));
      expect(second.outcome).toBe("created");
      expect(second.evidence.id).not.toBe(first.evidence.id);
    });

    it("converts a throwing getter during create into a typed INVALID_INPUT error, not a raw exception", async () => {
      const service = serviceFor("user-1");
      const hostileInput: Record<string, unknown> = { ...validInput() };
      Object.defineProperty(hostileInput, "title", {
        enumerable: true,
        get() {
          throw new Error("boom from a hostile getter");
        },
      });

      let caught: unknown;
      try {
        await service.create(hostileInput);
        throw new Error("expected create to reject");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ProjectEvidenceError);
      expect((caught as ProjectEvidenceError).code).toBe("INVALID_INPUT");
      expect((caught as Error).message).not.toMatch(/boom from a hostile getter/);
      expect(evidenceRepository.rows.size).toBe(0);
    });
  });

  describe("getById", () => {
    it("lets an owner read their own evidence, paired with its observation", async () => {
      const service = serviceFor("user-1");
      const created = await service.create(validInput());
      const read = await service.getById(created.evidence.id);
      expect(read.evidence).toEqual(created.evidence);
      expect(read.observation).toEqual(created.observation);
    });

    it("never returns another user's evidence, and does not distinguish it from not-found", async () => {
      const ownerService = serviceFor("user-1");
      const created = await ownerService.create(validInput());

      const otherService = serviceFor("user-2");
      await expect(otherService.getById(created.evidence.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("listByProject", () => {
    it("lists only evidence for the given project", async () => {
      const serviceA = serviceFor("user-1");
      const serviceB = serviceFor("user-2");
      await serviceA.create(validInput({ projectId: PROJECT_A, title: "A1" }));
      await serviceA.create(
        validInput({
          projectId: PROJECT_A,
          title: "A2",
          reference: "docs/architecture/execution-intent.md",
          observation: { textContent: "different content entirely", mimeType: "text/markdown" },
        }),
      );
      await serviceB.create(validInput({ projectId: PROJECT_B, title: "B1" }));

      const listA = await serviceA.listByProject(PROJECT_A);
      expect(listA.map((pair) => pair.evidence.title).sort()).toEqual(["A1", "A2"]);
    });

    it("rejects listing evidence for a project owned by another user, with no leakage", async () => {
      const serviceB = serviceFor("user-2");
      await serviceB.create(validInput({ projectId: PROJECT_B }));

      const serviceA = serviceFor("user-1");
      await expect(serviceA.listByProject(PROJECT_B)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    });

    it("excludes superseded records by default and includes them only when requested", async () => {
      const service = serviceFor("user-1");
      const original = await service.create(validInput());
      const superseding = await service.create(
        validInput({
          supersedesId: original.evidence.id,
          title: "Renamed",
          collectedAt: "2026-08-03T00:00:00.000Z",
          observation: { textContent: "# Project Domain (renamed)\n", mimeType: "text/markdown" },
        }),
      );

      const defaultList = await service.listByProject(PROJECT_A);
      expect(defaultList.map((pair) => pair.evidence.id)).toEqual([superseding.evidence.id]);

      const fullList = await service.listByProject(PROJECT_A, { includeSuperseded: true });
      expect(fullList.map((pair) => pair.evidence.id).sort()).toEqual(
        [original.evidence.id, superseding.evidence.id].sort(),
      );
    });

    it("still allows reading evidence for an archived project", async () => {
      const service = serviceFor("user-1");
      const created = await service.create(validInput());

      projectRepository.seed({ id: PROJECT_A, ownerId: "user-1", status: "archived" });

      const read = await service.getById(created.evidence.id);
      expect(read.evidence.id).toBe(created.evidence.id);
      const list = await service.listByProject(PROJECT_A);
      expect(list.map((pair) => pair.evidence.id)).toEqual([created.evidence.id]);
    });
  });

  describe("persistence and security shape", () => {
    it("never returns a credential, execution, or ProjectContext-derived field on either the evidence or the observation", async () => {
      const service = serviceFor("user-1");
      const created = await service.create(validInput());
      const forbiddenFields = [
        "accessToken",
        "credential",
        "token",
        "approvalState",
        "executionIntent",
        "runtimeResult",
        "policyDecision",
        "currentObjective",
        "milestones",
        "acceptedDecisions",
        "risks",
        "candidateActions",
        "freshness",
        "trustTier",
      ];
      for (const forbidden of forbiddenFields) {
        expect(Object.keys(created.evidence)).not.toContain(forbidden);
        expect(Object.keys(created.observation)).not.toContain(forbidden);
      }
    });

    it("every failure is a typed ProjectEvidenceError with a stable code", async () => {
      const service = serviceFor("user-1");
      try {
        await service.getById("does-not-exist");
        throw new Error("expected getById to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectEvidenceError);
        expect((error as ProjectEvidenceError).code).toBe("NOT_FOUND");
      }
    });
  });
});
