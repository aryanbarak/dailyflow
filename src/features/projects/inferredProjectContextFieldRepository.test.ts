import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

import {
  createSupabaseInferredProjectContextFieldRepository,
  InferredContextFieldPersistenceError,
  InferredContextFieldTransactionError,
} from "./inferredProjectContextFieldRepository";
import type { CreateInferredContextFieldInput } from "./inferredProjectContextFieldTypes";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";

function fieldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "field-1",
    user_id: "user-1",
    project_id: PROJECT_ID,
    run_id: RUN_ID,
    kind: "risk",
    content: { summary: "Data loss risk", severity: "high" },
    source_evidence_ids: [EVIDENCE_ID],
    model_identity: "gemini-test",
    derivation_version: "context-derivation-v1",
    confidence: "medium",
    status: "proposed",
    source: "model",
    supersedes_id: null,
    content_fingerprint: "a".repeat(64),
    created_at: "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

function createInput(overrides: Partial<CreateInferredContextFieldInput> = {}): CreateInferredContextFieldInput {
  return {
    projectId: PROJECT_ID,
    runId: RUN_ID,
    kind: "risk",
    content: { summary: "Data loss risk", severity: "high" },
    sourceEvidenceIds: [EVIDENCE_ID],
    modelIdentity: "gemini-test",
    derivationVersion: "context-derivation-v1",
    confidence: "medium",
    ...overrides,
  };
}

function chain(response: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => response);
  query.single = vi.fn(async () => response);
  // A bare `await` on the query object itself resolves the terminal
  // list-style call (listByProject's `.order(...)` is the last link and is
  // itself awaited directly by the repository, mirroring
  // projectEvidenceRepository.test.ts's identical chain helper).
  query.order = vi.fn(async () => response);
  return query;
}

describe("createSupabaseInferredProjectContextFieldRepository", () => {
  let repository: ReturnType<typeof createSupabaseInferredProjectContextFieldRepository>;

  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    repository = createSupabaseInferredProjectContextFieldRepository({ from: fromMock, rpc: rpcMock } as never);
  });

  describe("insert", () => {
    it("calls the create_inferred_context_field RPC (never a direct table insert) and maps a 'created' outcome", async () => {
      rpcMock.mockResolvedValue({ data: { outcome: "created", field: fieldRow() }, error: null });

      const result = await repository.insert(createInput());

      expect(rpcMock).toHaveBeenCalledWith(
        "create_inferred_context_field",
        expect.objectContaining({
          p_project_id: PROJECT_ID,
          p_run_id: RUN_ID,
          p_kind: "risk",
          p_source_evidence_ids: [EVIDENCE_ID],
          p_confidence: "medium",
        }),
      );
      expect(result.outcome).toBe("created");
      expect(result.field.id).toBe("field-1");
      expect(result.field.sourceEvidenceIds).toEqual([EVIDENCE_ID]);
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("computes the content fingerprint itself, never trusting a caller-supplied value", async () => {
      rpcMock.mockResolvedValue({ data: { outcome: "created", field: fieldRow() }, error: null });
      await repository.insert(createInput());
      const callArgs = rpcMock.mock.calls[0][1] as Record<string, unknown>;
      expect(typeof callArgs.p_content_fingerprint).toBe("string");
      expect((callArgs.p_content_fingerprint as string)).toHaveLength(64);
    });

    it("maps a duplicate_suppressed outcome without treating it as an error", async () => {
      rpcMock.mockResolvedValue({ data: { outcome: "duplicate_suppressed", field: fieldRow() }, error: null });
      const result = await repository.insert(createInput());
      expect(result.outcome).toBe("duplicate_suppressed");
    });

    it("review finding F3: maps DUPLICATE_LOOKUP_FAILED (the RPC's race-handler giving up) to a typed transaction error, never a generic persistence error", async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: "DUPLICATE_LOOKUP_FAILED" } });
      const error = await repository.insert(createInput()).catch((e) => e);
      expect(error).toBeInstanceOf(InferredContextFieldTransactionError);
      expect((error as InferredContextFieldTransactionError).code).toBe("DUPLICATE_LOOKUP_FAILED");
    });

    it("maps a raised transaction error code to InferredContextFieldTransactionError", async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: "PROJECT_ARCHIVED" } });
      await expect(repository.insert(createInput())).rejects.toBeInstanceOf(InferredContextFieldTransactionError);
    });

    it("maps an unrecognized RPC error to InferredContextFieldPersistenceError, never leaking the raw error", async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: "some unexpected database error" } });
      await expect(repository.insert(createInput())).rejects.toBeInstanceOf(InferredContextFieldPersistenceError);
    });

    it("fails closed on an incomplete RPC response (missing field id) rather than mapping undefined fields", async () => {
      rpcMock.mockResolvedValue({ data: { outcome: "created", field: {} }, error: null });
      await expect(repository.insert(createInput())).rejects.toBeInstanceOf(InferredContextFieldPersistenceError);
    });
  });

  describe("resolve", () => {
    it("confirms a proposed field via the resolve RPC", async () => {
      rpcMock.mockResolvedValue({
        data: { outcome: "user_confirmed", field: fieldRow({ status: "user_confirmed" }) },
        error: null,
      });
      const result = await repository.resolve({ fieldId: "field-1", action: "confirm" });
      expect(rpcMock).toHaveBeenCalledWith(
        "resolve_inferred_context_field",
        expect.objectContaining({ p_field_id: "field-1", p_action: "confirm", p_corrected_content: null }),
      );
      expect(result.outcome).toBe("user_confirmed");
    });

    it("rejects a correct action with no corrected content or fingerprint before ever calling the RPC", async () => {
      await expect(repository.resolve({ fieldId: "field-1", action: "correct" })).rejects.toBeInstanceOf(
        InferredContextFieldTransactionError,
      );
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("forwards the caller-computed corrected content fingerprint for a correct action", async () => {
      rpcMock.mockResolvedValue({
        data: { outcome: "user_corrected", field: fieldRow({ status: "user_confirmed", source: "user" }) },
        error: null,
      });
      await repository.resolve(
        { fieldId: "field-1", action: "correct", correctedContent: { summary: "Fixed", severity: "low" } },
        "b".repeat(64),
      );
      expect(rpcMock).toHaveBeenCalledWith(
        "resolve_inferred_context_field",
        expect.objectContaining({ p_corrected_content_fingerprint: "b".repeat(64) }),
      );
    });

    it("maps FIELD_NOT_PROPOSED to a transaction error", async () => {
      rpcMock.mockResolvedValue({ data: null, error: { message: "FIELD_NOT_PROPOSED" } });
      await expect(repository.resolve({ fieldId: "field-1", action: "reject" })).rejects.toBeInstanceOf(
        InferredContextFieldTransactionError,
      );
    });
  });

  describe("findById / listByProject", () => {
    it("filters findById by id and owner", async () => {
      fromMock.mockReturnValue(chain({ data: fieldRow(), error: null }));
      const result = await repository.findById("user-1", "field-1");
      expect(result?.id).toBe("field-1");
      const query = fromMock.mock.results[0].value;
      expect(query.eq).toHaveBeenCalledWith("id", "field-1");
      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
    });

    it("returns null when no row matches (not found or not owned)", async () => {
      fromMock.mockReturnValue(chain({ data: null, error: null }));
      expect(await repository.findById("user-1", "missing")).toBeNull();
    });

    it("filters listByProject by owner and project", async () => {
      fromMock.mockReturnValue(chain({ data: [fieldRow()], error: null }));
      const result = await repository.listByProject("user-1", PROJECT_ID);
      expect(result).toHaveLength(1);
      const query = fromMock.mock.results[0].value;
      expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
      expect(query.eq).toHaveBeenCalledWith("project_id", PROJECT_ID);
    });
  });

  describe("createRun / completeRun", () => {
    it("creates a run row via a plain insert (no SECURITY DEFINER function needed for run metadata)", async () => {
      const insertChain = chain({
        data: {
          id: RUN_ID,
          user_id: "user-1",
          project_id: PROJECT_ID,
          model_identity: "gemini-test",
          derivation_version: "context-derivation-v1",
          started_at: "2026-08-07T00:00:00.000Z",
          completed_at: null,
          prompt_token_count: null,
          response_token_count: null,
          candidate_count: 0,
          accepted_count: 0,
          dropped_count: 0,
          outcome: null,
          failure_reason: null,
        },
        error: null,
      });
      insertChain.insert = vi.fn(() => insertChain);
      fromMock.mockReturnValue(insertChain);

      const run = await repository.createRun({
        projectId: PROJECT_ID,
        modelIdentity: "gemini-test",
        derivationVersion: "context-derivation-v1",
        startedAt: "2026-08-07T00:00:00.000Z",
      });
      expect(run.id).toBe(RUN_ID);
      expect(insertChain.insert).toHaveBeenCalled();
    });

    it("completes a run with token counts and outcome via update", async () => {
      const updateChain = chain({
        data: {
          id: RUN_ID,
          user_id: "user-1",
          project_id: PROJECT_ID,
          model_identity: "gemini-test",
          derivation_version: "context-derivation-v1",
          started_at: "2026-08-07T00:00:00.000Z",
          completed_at: "2026-08-07T00:00:05.000Z",
          prompt_token_count: 120,
          response_token_count: 340,
          candidate_count: 3,
          accepted_count: 2,
          dropped_count: 1,
          outcome: "completed",
          failure_reason: null,
        },
        error: null,
      });
      updateChain.update = vi.fn(() => updateChain);
      fromMock.mockReturnValue(updateChain);

      const run = await repository.completeRun({
        runId: RUN_ID,
        completedAt: "2026-08-07T00:00:05.000Z",
        promptTokenCount: 120,
        responseTokenCount: 340,
        candidateCount: 3,
        acceptedCount: 2,
        droppedCount: 1,
        outcome: "completed",
      });
      expect(run.outcome).toBe("completed");
      expect(run.promptTokenCount).toBe(120);
    });
  });
});
