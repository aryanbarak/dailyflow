import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}));

import {
  createSupabaseProjectEvidenceRepository,
  ProjectEvidenceConflictError,
  ProjectEvidencePersistenceError,
  ProjectEvidenceTransactionError,
} from "./projectEvidenceRepository";
import type { NormalizedCreateProjectEvidenceInput } from "./projectEvidenceTypes";

const VALID_PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function evidenceRow(overrides: Record<string, unknown> = {}) {
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

function observationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "observation-1",
    evidence_id: "evidence-1",
    user_id: "user-1",
    project_id: VALID_PROJECT_ID,
    payload_kind: "text",
    text_content: "# Project Domain\n",
    mime_type: "text/markdown",
    byte_length: new TextEncoder().encode("# Project Domain\n").length,
    content_hash: "b".repeat(64),
    git_revision: null,
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
    observation: {
      payloadKind: "text",
      textContent: "# Project Domain\n",
      mimeType: "text/markdown",
      byteLength: new TextEncoder().encode("# Project Domain\n").length,
    },
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
  query.in = vi.fn(async () => response);
  return query;
}

describe("createSupabaseProjectEvidenceRepository", () => {
  let repository: ReturnType<typeof createSupabaseProjectEvidenceRepository>;

  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    repository = createSupabaseProjectEvidenceRepository();
  });

  describe("insert", () => {
    it("calls the atomic RPC (never a direct table insert) and maps a 'created' outcome", async () => {
      rpcMock.mockResolvedValueOnce({ data: { outcome: "created", evidence: evidenceRow(), observation: observationRow() }, error: null });

      const result = await repository.insert("user-1", VALID_PROJECT_ID, validInput());

      expect(rpcMock).toHaveBeenCalledWith(
        "create_project_evidence_with_observation",
        expect.objectContaining({
          p_project_id: VALID_PROJECT_ID,
          p_source_kind: "architecture_document",
          p_classification: "canonical_document_observation",
          p_text_content: "# Project Domain\n",
          p_mime_type: "text/markdown",
          p_byte_length: new TextEncoder().encode("# Project Domain\n").length,
        }),
      );
      expect(fromMock).not.toHaveBeenCalled();
      expect(result.outcome).toBe("created");
      expect(result.evidence).toEqual({
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
      expect(result.observation).toEqual({
        id: "observation-1",
        evidenceId: "evidence-1",
        projectId: VALID_PROJECT_ID,
        ownerId: "user-1",
        payloadKind: "text",
        textContent: "# Project Domain\n",
        mimeType: "text/markdown",
        byteLength: new TextEncoder().encode("# Project Domain\n").length,
        contentHash: "b".repeat(64),
        createdAt: "2026-08-02T00:00:01.000Z",
      });
    });

    it("maps an 'unchanged' outcome from the RPC without treating it as an error", async () => {
      rpcMock.mockResolvedValueOnce({ data: { outcome: "unchanged", evidence: evidenceRow(), observation: observationRow() }, error: null });

      const result = await repository.insert("user-1", VALID_PROJECT_ID, validInput());
      expect(result.outcome).toBe("unchanged");
    });

    it("computes the content hash server-side over the exact observation text, never trusting a caller-supplied value", async () => {
      rpcMock.mockResolvedValueOnce({ data: { outcome: "created", evidence: evidenceRow(), observation: observationRow() }, error: null });

      await repository.insert("user-1", VALID_PROJECT_ID, validInput());

      const expectedHash = await crypto.subtle
        .digest("SHA-256", new TextEncoder().encode("# Project Domain\n"))
        .then((digest) => Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""));

      expect(rpcMock).toHaveBeenCalledWith(
        "create_project_evidence_with_observation",
        expect.objectContaining({ p_content_hash: expectedHash }),
      );
    });

    it("computes a candidate fingerprint that excludes collectedAt and includes the content hash", async () => {
      rpcMock.mockResolvedValue({ data: { outcome: "created", evidence: evidenceRow(), observation: observationRow() }, error: null });

      await repository.insert("user-1", VALID_PROJECT_ID, validInput({ collectedAt: "2026-08-02T00:00:00.000Z" }));
      const fingerprintA = rpcMock.mock.calls[0][1].p_candidate_fingerprint;

      await repository.insert("user-1", VALID_PROJECT_ID, validInput({ collectedAt: "2026-09-01T00:00:00.000Z" }));
      const fingerprintB = rpcMock.mock.calls[1][1].p_candidate_fingerprint;

      // Same project/source/reference/content/adapter, only collectedAt
      // differs -- the fingerprint must be identical (ADR-0007's whole
      // point: collectedAt must not participate in duplicate identity).
      expect(fingerprintA).toBe(fingerprintB);
      expect(fingerprintA).toHaveLength(64);

      await repository.insert(
        "user-1",
        VALID_PROJECT_ID,
        validInput({ observation: { payloadKind: "text", textContent: "different content", mimeType: "text/markdown", byteLength: 17 } }),
      );
      const fingerprintC = rpcMock.mock.calls[2][1].p_candidate_fingerprint;
      expect(fingerprintC).not.toBe(fingerprintA);
    });

    it("maps a typed transaction error raised by the RPC (e.g. PROJECT_ARCHIVED) to ProjectEvidenceTransactionError", async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "PROJECT_ARCHIVED" } });

      const error = await repository.insert("user-1", VALID_PROJECT_ID, validInput()).catch((e) => e);
      expect(error).toBeInstanceOf(ProjectEvidenceTransactionError);
      expect((error as ProjectEvidenceTransactionError).code).toBe("PROJECT_ARCHIVED");
    });

    it("maps a raw unique-violation (not otherwise handled by the RPC) to ProjectEvidenceConflictError", async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } });

      await expect(repository.insert("user-1", VALID_PROJECT_ID, validInput())).rejects.toBeInstanceOf(
        ProjectEvidenceConflictError,
      );
    });

    it("maps any other RPC error to ProjectEvidencePersistenceError", async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });

      await expect(repository.insert("user-1", VALID_PROJECT_ID, validInput())).rejects.toBeInstanceOf(
        ProjectEvidencePersistenceError,
      );
    });

    it("maps the RPC's own EVIDENCE_CONFLICT_LOOKUP_FAILED fail-closed guard to a typed ProjectEvidenceTransactionError", async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "EVIDENCE_CONFLICT_LOOKUP_FAILED" } });

      const error = await repository.insert("user-1", VALID_PROJECT_ID, validInput()).catch((e) => e);
      expect(error).toBeInstanceOf(ProjectEvidenceTransactionError);
      expect((error as ProjectEvidenceTransactionError).code).toBe("EVIDENCE_CONFLICT_LOOKUP_FAILED");
    });

    it("maps the RPC's own EVIDENCE_MISSING_OBSERVATION fail-closed guard to a typed ProjectEvidenceTransactionError", async () => {
      rpcMock.mockResolvedValueOnce({ data: null, error: { message: "EVIDENCE_MISSING_OBSERVATION" } });

      const error = await repository.insert("user-1", VALID_PROJECT_ID, validInput()).catch((e) => e);
      expect(error).toBeInstanceOf(ProjectEvidenceTransactionError);
      expect((error as ProjectEvidenceTransactionError).code).toBe("EVIDENCE_MISSING_OBSERVATION");
    });

    it("never accepts a malformed RPC success payload: an unrecognized outcome is treated as a persistence failure, not mapped blindly", async () => {
      rpcMock.mockResolvedValueOnce({ data: { outcome: "bogus", evidence: evidenceRow(), observation: observationRow() }, error: null });

      await expect(repository.insert("user-1", VALID_PROJECT_ID, validInput())).rejects.toBeInstanceOf(
        ProjectEvidencePersistenceError,
      );
    });

    it("never accepts a null evidence row on an otherwise-successful RPC response", async () => {
      rpcMock.mockResolvedValueOnce({ data: { outcome: "unchanged", evidence: null, observation: observationRow() }, error: null });

      await expect(repository.insert("user-1", VALID_PROJECT_ID, validInput())).rejects.toBeInstanceOf(
        ProjectEvidencePersistenceError,
      );
    });

    it("never accepts a null observation row on an otherwise-successful RPC response", async () => {
      rpcMock.mockResolvedValueOnce({ data: { outcome: "unchanged", evidence: evidenceRow(), observation: null }, error: null });

      await expect(repository.insert("user-1", VALID_PROJECT_ID, validInput())).rejects.toBeInstanceOf(
        ProjectEvidencePersistenceError,
      );
    });

    it("never accepts an evidence or observation row missing its id, even if otherwise well-formed", async () => {
      rpcMock.mockResolvedValueOnce({
        data: { outcome: "created", evidence: evidenceRow({ id: null }), observation: observationRow() },
        error: null,
      });

      await expect(repository.insert("user-1", VALID_PROJECT_ID, validInput())).rejects.toBeInstanceOf(
        ProjectEvidencePersistenceError,
      );
    });

    it("passes through the optional Git revision and omits it when absent", async () => {
      rpcMock.mockResolvedValue({ data: { outcome: "created", evidence: evidenceRow(), observation: observationRow() }, error: null });

      await repository.insert(
        "user-1",
        VALID_PROJECT_ID,
        validInput({ observation: { payloadKind: "text", textContent: "x", mimeType: "text/markdown", byteLength: 1, gitRevision: "a".repeat(40) } }),
      );
      expect(rpcMock.mock.calls[0][1].p_git_revision).toBe("a".repeat(40));

      await repository.insert("user-1", VALID_PROJECT_ID, validInput());
      expect(rpcMock.mock.calls[1][1].p_git_revision).toBeNull();
    });
  });

  describe("findById", () => {
    it("loads the evidence row and its paired observation", async () => {
      const evidenceQuery = chain(["select", "eq"], { data: evidenceRow(), error: null });
      const observationQuery = chain(["select"], { data: [observationRow()], error: null });
      fromMock.mockReturnValueOnce(evidenceQuery).mockReturnValueOnce(observationQuery);

      const result = await repository.findById("user-1", "evidence-1");

      expect(evidenceQuery.eq).toHaveBeenCalledWith("id", "evidence-1");
      expect(evidenceQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(result?.evidence.id).toBe("evidence-1");
      expect(result?.observation.id).toBe("observation-1");
      expect(result?.observation.textContent).toBe("# Project Domain\n");
    });

    it("returns null when no owned evidence row matches, without querying observations", async () => {
      const evidenceQuery = chain(["select", "eq"], { data: null, error: null });
      fromMock.mockReturnValueOnce(evidenceQuery);

      const result = await repository.findById("user-1", "does-not-exist");
      expect(result).toBeNull();
      expect(fromMock).toHaveBeenCalledTimes(1);
    });

    it("wraps an evidence read error", async () => {
      const evidenceQuery = chain(["select", "eq"], { data: null, error: { message: "boom" } });
      fromMock.mockReturnValueOnce(evidenceQuery);

      await expect(repository.findById("user-1", "evidence-1")).rejects.toBeInstanceOf(ProjectEvidencePersistenceError);
    });

    it("treats a missing paired observation as a persistence inconsistency, never a silent metadata-only result", async () => {
      const evidenceQuery = chain(["select", "eq"], { data: evidenceRow(), error: null });
      const observationQuery = chain(["select"], { data: [], error: null });
      fromMock.mockReturnValueOnce(evidenceQuery).mockReturnValueOnce(observationQuery);

      await expect(repository.findById("user-1", "evidence-1")).rejects.toBeInstanceOf(ProjectEvidencePersistenceError);
    });
  });

  describe("listByProject", () => {
    it("filters by owner and project and pairs each evidence row with its observation", async () => {
      const evidenceQuery = chain(["select", "eq"], { data: [evidenceRow()], error: null });
      const observationQuery = chain(["select"], { data: [observationRow()], error: null });
      fromMock.mockReturnValueOnce(evidenceQuery).mockReturnValueOnce(observationQuery);

      const result = await repository.listByProject("user-1", VALID_PROJECT_ID, { includeSuperseded: true });

      expect(evidenceQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(evidenceQuery.eq).toHaveBeenCalledWith("project_id", VALID_PROJECT_ID);
      expect(result).toHaveLength(1);
      expect(result[0].observation.contentHash).toBe("b".repeat(64));
    });

    it("excludes a record that another record's supersedesId references, unless includeSuperseded is set", async () => {
      const evidenceQuery = chain(["select", "eq"], {
        data: [evidenceRow({ id: "old", supersedes_id: null }), evidenceRow({ id: "new", supersedes_id: "old" })],
        error: null,
      });
      const observationQuery = chain(["select"], {
        data: [observationRow({ id: "obs-old", evidence_id: "old" }), observationRow({ id: "obs-new", evidence_id: "new" })],
        error: null,
      });
      fromMock.mockReturnValueOnce(evidenceQuery).mockReturnValueOnce(observationQuery);

      const filtered = await repository.listByProject("user-1", VALID_PROJECT_ID, { includeSuperseded: false });
      expect(filtered.map((pair) => pair.evidence.id)).toEqual(["new"]);
    });

    it("includes superseded records when explicitly requested", async () => {
      const evidenceQuery = chain(["select", "eq"], {
        data: [evidenceRow({ id: "old", supersedes_id: null }), evidenceRow({ id: "new", supersedes_id: "old" })],
        error: null,
      });
      const observationQuery = chain(["select"], {
        data: [observationRow({ id: "obs-old", evidence_id: "old" }), observationRow({ id: "obs-new", evidence_id: "new" })],
        error: null,
      });
      fromMock.mockReturnValueOnce(evidenceQuery).mockReturnValueOnce(observationQuery);

      const all = await repository.listByProject("user-1", VALID_PROJECT_ID, { includeSuperseded: true });
      expect(all.map((pair) => pair.evidence.id).sort()).toEqual(["new", "old"]);
    });

    it("wraps a list error", async () => {
      const evidenceQuery = chain(["select", "eq"], { data: null, error: { message: "boom" } });
      fromMock.mockReturnValueOnce(evidenceQuery);

      await expect(
        repository.listByProject("user-1", VALID_PROJECT_ID, { includeSuperseded: false }),
      ).rejects.toBeInstanceOf(ProjectEvidencePersistenceError);
    });
  });
});
