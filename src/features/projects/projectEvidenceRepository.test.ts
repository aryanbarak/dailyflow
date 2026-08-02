import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import {
  createSupabaseProjectEvidenceRepository,
  ProjectEvidenceConflictError,
  ProjectEvidencePersistenceError,
} from "./projectEvidenceRepository";
import type { NormalizedCreateProjectEvidenceInput } from "./projectEvidenceTypes";

const VALID_PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "evidence-1",
    user_id: "user-1",
    project_id: VALID_PROJECT_ID,
    source_kind: "architecture_document",
    classification: "canonical_document_observation",
    title: "Project Domain",
    reference: "docs/architecture/project-domain.md",
    collected_at: "2026-08-02T00:00:00.000Z",
    adapter_identity: "repository-document-adapter",
    adapter_version: "1.0.0",
    verification_method: "deterministic file read",
    source_revision: null,
    confidence: null,
    uncertainty: null,
    notes: null,
    supersedes_id: null,
    acquisition_attempt_id: null,
    created_at: "2026-08-02T00:00:01.000Z",
    ...overrides,
  };
}

function validInput(overrides: Partial<NormalizedCreateProjectEvidenceInput> = {}): NormalizedCreateProjectEvidenceInput {
  return {
    projectId: VALID_PROJECT_ID,
    sourceKind: "architecture_document",
    classification: "canonical_document_observation",
    title: "Project Domain",
    reference: "docs/architecture/project-domain.md",
    collectedAt: "2026-08-02T00:00:00.000Z",
    adapterIdentity: "repository-document-adapter",
    adapterVersion: "1.0.0",
    verificationMethod: "deterministic file read",
    ...overrides,
  };
}

function chain(methods: string[], response: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of methods) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => response);
  query.maybeSingle = vi.fn(async () => response);
  query.order = vi.fn(async () => response);
  return query;
}

describe("createSupabaseProjectEvidenceRepository", () => {
  let repository: ReturnType<typeof createSupabaseProjectEvidenceRepository>;

  beforeEach(() => {
    fromMock.mockReset();
    repository = createSupabaseProjectEvidenceRepository();
  });

  describe("insert", () => {
    it("inserts with the given owner and project id and maps the returned row", async () => {
      const query = chain(["insert", "select"], { data: row(), error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.insert("user-1", VALID_PROJECT_ID, validInput());

      expect(fromMock).toHaveBeenCalledWith("project_evidence");
      expect(query.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          project_id: VALID_PROJECT_ID,
          source_kind: "architecture_document",
          classification: "canonical_document_observation",
        }),
      );
      expect(result).toEqual({
        id: "evidence-1",
        projectId: VALID_PROJECT_ID,
        ownerId: "user-1",
        sourceKind: "architecture_document",
        classification: "canonical_document_observation",
        title: "Project Domain",
        reference: "docs/architecture/project-domain.md",
        collectedAt: "2026-08-02T00:00:00.000Z",
        adapterIdentity: "repository-document-adapter",
        adapterVersion: "1.0.0",
        verificationMethod: "deterministic file read",
        createdAt: "2026-08-02T00:00:01.000Z",
      });
    });

    it("computes and stores a stable candidate fingerprint from the canonical immutable fields", async () => {
      const query = chain(["insert", "select"], { data: row(), error: null });
      fromMock.mockReturnValueOnce(query);

      await repository.insert("user-1", VALID_PROJECT_ID, validInput());

      const insertedPatch = query.insert.mock.calls[0][0];
      expect(typeof insertedPatch.candidate_fingerprint).toBe("string");
      expect(insertedPatch.candidate_fingerprint).toHaveLength(64);
    });

    it("produces the same fingerprint for the same canonical fields and a different one when collectedAt differs", async () => {
      const queryA = chain(["insert", "select"], { data: row(), error: null });
      fromMock.mockReturnValueOnce(queryA);
      await repository.insert("user-1", VALID_PROJECT_ID, validInput());
      const fingerprintA = queryA.insert.mock.calls[0][0].candidate_fingerprint;

      const queryB = chain(["insert", "select"], { data: row(), error: null });
      fromMock.mockReturnValueOnce(queryB);
      await repository.insert("user-1", VALID_PROJECT_ID, validInput());
      const fingerprintB = queryB.insert.mock.calls[0][0].candidate_fingerprint;
      expect(fingerprintB).toBe(fingerprintA);

      const queryC = chain(["insert", "select"], { data: row(), error: null });
      fromMock.mockReturnValueOnce(queryC);
      await repository.insert("user-1", VALID_PROJECT_ID, validInput({ collectedAt: "2026-08-03T00:00:00.000Z" }));
      const fingerprintC = queryC.insert.mock.calls[0][0].candidate_fingerprint;
      expect(fingerprintC).not.toBe(fingerprintA);
    });

    it("maps a unique-violation error to ProjectEvidenceConflictError", async () => {
      const query = chain(["insert", "select"], { data: null, error: { code: "23505", message: "duplicate key" } });
      fromMock.mockReturnValueOnce(query);

      await expect(repository.insert("user-1", VALID_PROJECT_ID, validInput())).rejects.toBeInstanceOf(
        ProjectEvidenceConflictError,
      );
    });

    it("maps any other error to ProjectEvidencePersistenceError", async () => {
      const query = chain(["insert", "select"], { data: null, error: { code: "42501", message: "denied" } });
      fromMock.mockReturnValueOnce(query);

      await expect(repository.insert("user-1", VALID_PROJECT_ID, validInput())).rejects.toBeInstanceOf(
        ProjectEvidencePersistenceError,
      );
    });

    it("maps optional fields when present", async () => {
      const query = chain(["insert", "select"], {
        data: row({ source_revision: "ae14be6", confidence: 0.9, uncertainty: "unverified", notes: "note", supersedes_id: "old" }),
        error: null,
      });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.insert(
        "user-1",
        VALID_PROJECT_ID,
        validInput({ sourceRevision: "ae14be6", confidence: 0.9, uncertainty: "unverified", notes: "note", supersedesId: "old" }),
      );
      expect(result.sourceRevision).toBe("ae14be6");
      expect(result.confidence).toBe(0.9);
      expect(result.uncertainty).toBe("unverified");
      expect(result.notes).toBe("note");
      expect(result.supersedesId).toBe("old");
    });
  });

  describe("findById", () => {
    it("filters by id and owner and maps a found row", async () => {
      const query = chain(["select", "eq"], { data: row(), error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.findById("user-1", "evidence-1");

      expect(query.eq).toHaveBeenCalledWith("id", "evidence-1");
      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(result?.id).toBe("evidence-1");
    });

    it("returns null when no owned row matches", async () => {
      const query = chain(["select", "eq"], { data: null, error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.findById("user-1", "does-not-exist");
      expect(result).toBeNull();
    });

    it("wraps a read error", async () => {
      const query = chain(["select", "eq"], { data: null, error: { message: "boom" } });
      fromMock.mockReturnValueOnce(query);

      await expect(repository.findById("user-1", "evidence-1")).rejects.toBeInstanceOf(ProjectEvidencePersistenceError);
    });
  });

  describe("listByProject", () => {
    it("filters by owner and project", async () => {
      const query = chain(["select", "eq"], { data: [row()], error: null });
      fromMock.mockReturnValueOnce(query);

      const result = await repository.listByProject("user-1", VALID_PROJECT_ID, { includeSuperseded: true });

      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(query.eq).toHaveBeenCalledWith("project_id", VALID_PROJECT_ID);
      expect(result).toHaveLength(1);
    });

    it("excludes a record that another record's supersedesId references, unless includeSuperseded is set", async () => {
      const query = chain(["select", "eq"], {
        data: [row({ id: "old", supersedes_id: null }), row({ id: "new", supersedes_id: "old" })],
        error: null,
      });
      fromMock.mockReturnValueOnce(query);

      const filtered = await repository.listByProject("user-1", VALID_PROJECT_ID, { includeSuperseded: false });
      expect(filtered.map((e) => e.id)).toEqual(["new"]);
    });

    it("includes superseded records when explicitly requested", async () => {
      const query = chain(["select", "eq"], {
        data: [row({ id: "old", supersedes_id: null }), row({ id: "new", supersedes_id: "old" })],
        error: null,
      });
      fromMock.mockReturnValueOnce(query);

      const all = await repository.listByProject("user-1", VALID_PROJECT_ID, { includeSuperseded: true });
      expect(all.map((e) => e.id).sort()).toEqual(["new", "old"]);
    });

    it("wraps a list error", async () => {
      const query = chain(["select", "eq"], { data: null, error: { message: "boom" } });
      fromMock.mockReturnValueOnce(query);

      await expect(
        repository.listByProject("user-1", VALID_PROJECT_ID, { includeSuperseded: false }),
      ).rejects.toBeInstanceOf(ProjectEvidencePersistenceError);
    });
  });
});
