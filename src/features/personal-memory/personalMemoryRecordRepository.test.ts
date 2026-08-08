import { describe, expect, it, vi } from "vitest";
import { createSupabasePersonalMemoryRecordRepository, PersonalMemoryRecordTransactionError, PersonalMemoryRecordPersistenceError } from "./personalMemoryRecordRepository";

const OWNER_ID = "user-1";
const CHAT_ID = "22222222-2222-4222-8222-222222222222";

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "record-1",
    user_id: OWNER_ID,
    run_id: "run-1",
    kind: "preference",
    content: { summary: "Prefers async updates" },
    provenance_source_kind: "chat_turn",
    provenance_source_ref_ids: [CHAT_ID],
    model_identity: "gemini-test",
    derivation_version: "personal-memory-extraction-v1",
    confidence: "medium",
    status: "proposed",
    source: "model",
    supersedes_id: null,
    content_fingerprint: "a".repeat(64),
    created_at: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function fakeClient(overrides: {
  rpc?: ReturnType<typeof vi.fn>;
  from?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    rpc: overrides.rpc ?? vi.fn(),
    from: overrides.from ?? vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("createSupabasePersonalMemoryRecordRepository -- insert", () => {
  it("maps a created outcome", async () => {
    const rpc = vi.fn(async () => ({ data: { outcome: "created", field: fakeRow() }, error: null }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ rpc }));

    const result = await repository.insert({
      runId: "run-1",
      kind: "preference",
      content: { summary: "Prefers async updates" },
      provenance: { sourceKind: "chat_turn", sourceReferenceIds: [CHAT_ID] },
      modelIdentity: "gemini-test",
      derivationVersion: "personal-memory-extraction-v1",
      confidence: "medium",
    });

    expect(result.outcome).toBe("created");
    expect(result.record.ownerId).toBe(OWNER_ID);
    expect(rpc).toHaveBeenCalledWith(
      "create_personal_memory_record",
      expect.objectContaining({ p_kind: "preference", p_provenance_source_kind: "chat_turn", p_provenance_source_ref_ids: [CHAT_ID] }),
    );
  });

  it("maps a RUN_NOT_FOUND error to a typed transaction error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "RUN_NOT_FOUND" } }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ rpc }));

    await expect(
      repository.insert({
        runId: "missing-run",
        kind: "preference",
        content: { summary: "x" },
        provenance: { sourceKind: "chat_turn", sourceReferenceIds: [CHAT_ID] },
        modelIdentity: "gemini-test",
        derivationVersion: "v1",
        confidence: "low",
      }),
    ).rejects.toBeInstanceOf(PersonalMemoryRecordTransactionError);
  });

  it("wraps an unrecognized error as a generic persistence error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "some raw postgres error" } }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ rpc }));

    await expect(
      repository.insert({
        runId: "run-1",
        kind: "preference",
        content: { summary: "x" },
        provenance: { sourceKind: "chat_turn", sourceReferenceIds: [CHAT_ID] },
        modelIdentity: "gemini-test",
        derivationVersion: "v1",
        confidence: "low",
      }),
    ).rejects.toBeInstanceOf(PersonalMemoryRecordPersistenceError);
  });
});

describe("createSupabasePersonalMemoryRecordRepository -- resolve", () => {
  it("requires corrected content and its fingerprint for a correct action", async () => {
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient());
    await expect(repository.resolve({ recordId: "record-1", action: "correct" })).rejects.toBeInstanceOf(PersonalMemoryRecordTransactionError);
  });

  it("maps a user_corrected outcome", async () => {
    const rpc = vi.fn(async () => ({
      data: { outcome: "user_corrected", field: fakeRow({ id: "record-2", source: "user", supersedes_id: "record-1", status: "user_confirmed" }) },
      error: null,
    }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ rpc }));

    const result = await repository.resolve(
      { recordId: "record-1", action: "correct", correctedContent: { summary: "Updated summary" } },
      "b".repeat(64),
    );
    expect(result.outcome).toBe("user_corrected");
    expect(result.record.supersedesId).toBe("record-1");
  });
});

describe("createSupabasePersonalMemoryRecordRepository -- remove (ADR-0010 Q1)", () => {
  it("maps a deleted outcome", async () => {
    const rpc = vi.fn(async () => ({ data: { outcome: "deleted", id: "record-1" }, error: null }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ rpc }));

    const result = await repository.remove("record-1");
    expect(result).toEqual({ outcome: "deleted", id: "record-1" });
    expect(rpc).toHaveBeenCalledWith("delete_personal_memory_record", { p_record_id: "record-1" });
  });

  it("maps a RECORD_NOT_FOUND error (missing or not owned) to a typed transaction error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "RECORD_NOT_FOUND" } }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ rpc }));

    await expect(repository.remove("someone-elses-record")).rejects.toBeInstanceOf(PersonalMemoryRecordTransactionError);
  });
});

describe("createSupabasePersonalMemoryRecordRepository -- listByOwner", () => {
  it("scopes strictly to the given owner (no project dimension)", async () => {
    const eq = vi.fn().mockReturnThis();
    const order = vi.fn(async () => ({ data: [fakeRow()], error: null }));
    const select = vi.fn(() => ({ eq, order }));
    const from = vi.fn(() => ({ select }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ from }));

    const result = await repository.listByOwner(OWNER_ID);
    expect(from).toHaveBeenCalledWith("personal_memory_records");
    expect(eq).toHaveBeenCalledWith("user_id", OWNER_ID);
    expect(result).toHaveLength(1);
  });
});

describe("createSupabasePersonalMemoryRecordRepository -- listConfirmedByOwner (ADR-0011)", () => {
  it("filters status IN (user_confirmed, user_corrected) inside the query, orders newest first, and applies the limit", async () => {
    const confirmedRow = fakeRow({ id: "confirmed-1", status: "user_confirmed" });
    const limit = vi.fn(async () => ({ data: [confirmedRow], error: null }));
    const order = vi.fn(() => ({ limit }));
    const inFilter = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ in: inFilter }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ from }));

    const result = await repository.listConfirmedByOwner(OWNER_ID, 15);

    expect(from).toHaveBeenCalledWith("personal_memory_records");
    expect(eq).toHaveBeenCalledWith("user_id", OWNER_ID);
    expect(inFilter).toHaveBeenCalledWith("status", ["user_confirmed", "user_corrected"]);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(15);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("confirmed-1");
  });

  it("defaults the limit to 30 when not given", async () => {
    const limit = vi.fn(async () => ({ data: [], error: null }));
    const order = vi.fn(() => ({ limit }));
    const inFilter = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ in: inFilter }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const repository = createSupabasePersonalMemoryRecordRepository(fakeClient({ from }));

    await repository.listConfirmedByOwner(OWNER_ID);
    expect(limit).toHaveBeenCalledWith(30);
  });
});
