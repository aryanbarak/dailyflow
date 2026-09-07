// CORE-W6 (2026-09-07, ADR-0023 SS2): the recall-log repository -- the
// join-based read (a cascaded-away record's row simply isn't returned, no
// null-embed special case) and the tutor's log_personal_memory_recall RPC.
import { describe, expect, it, vi } from "vitest";
import {
  createSupabasePersonalMemoryRecallLogRepository,
  PersonalMemoryRecallLogPersistenceError,
  PersonalMemoryRecallLogTransactionError,
} from "./personalMemoryRecallLogRepository";

function fakeClient(overrides: { rpc?: ReturnType<typeof vi.fn>; from?: ReturnType<typeof vi.fn> } = {}) {
  return {
    rpc: overrides.rpc ?? vi.fn(),
    from: overrides.from ?? vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    record_id: "record-1",
    consumer: "chat",
    recall_batch_id: "batch-1",
    created_at: "2026-09-07T09:00:00.000Z",
    personal_memory_records: { kind: "preference", content: { summary: "Prefers async written updates" } },
    ...overrides,
  };
}

describe("createSupabasePersonalMemoryRecallLogRepository -- listByOwner", () => {
  it("maps a joined row into a display entry", async () => {
    const limit = vi.fn(async () => ({ data: [fakeRow()], error: null }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const repository = createSupabasePersonalMemoryRecallLogRepository(fakeClient({ from }));

    const result = await repository.listByOwner("user-1");

    expect(from).toHaveBeenCalledWith("personal_memory_recall_log");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual([{
      id: "log-1",
      recordId: "record-1",
      recordKind: "preference",
      recordPrimaryText: "Prefers async written updates",
      consumer: "chat",
      recallBatchId: "batch-1",
      createdAt: "2026-09-07T09:00:00.000Z",
    }]);
  });

  it("the one behavior this schema exists to guarantee: a batch citing 3 ids where 1 was since deleted renders with 2, no crash, no phantom entry", async () => {
    // The migration's ON DELETE CASCADE already removed the deleted
    // record's own row entirely -- so the query only ever returns the 2
    // still-live rows in the first place. This test proves the repository
    // maps that correctly, with no attempt to render a 3rd "ghost" entry.
    const rows = [
      fakeRow({ id: "log-1", record_id: "record-1" }),
      fakeRow({ id: "log-2", record_id: "record-2" }),
    ];
    const limit = vi.fn(async () => ({ data: rows, error: null }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const repository = createSupabasePersonalMemoryRecallLogRepository(fakeClient({ from }));

    const result = await repository.listByOwner("user-1");
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.recordId)).toEqual(["record-1", "record-2"]);
  });

  it("drops a row with a null embedded record defensively, rather than rendering placeholder text", async () => {
    const limit = vi.fn(async () => ({ data: [fakeRow({ personal_memory_records: null })], error: null }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const repository = createSupabasePersonalMemoryRecallLogRepository(fakeClient({ from }));

    const result = await repository.listByOwner("user-1");
    expect(result).toHaveLength(0);
  });

  it("wraps a query error as a persistence error", async () => {
    const limit = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const repository = createSupabasePersonalMemoryRecallLogRepository(fakeClient({ from }));

    await expect(repository.listByOwner("user-1")).rejects.toBeInstanceOf(PersonalMemoryRecallLogPersistenceError);
  });
});

describe("createSupabasePersonalMemoryRecallLogRepository -- logTutorRecall", () => {
  it("calls the RPC with p_consumer='tutor' and returns the batch id", async () => {
    const rpc = vi.fn(async () => ({ data: { outcome: "logged", recallBatchId: "batch-9" }, error: null }));
    const repository = createSupabasePersonalMemoryRecallLogRepository(fakeClient({ rpc }));

    const result = await repository.logTutorRecall(["record-1", "record-2"]);

    expect(rpc).toHaveBeenCalledWith("log_personal_memory_recall", { p_record_ids: ["record-1", "record-2"], p_consumer: "tutor" });
    expect(result).toEqual({ recallBatchId: "batch-9" });
  });

  it("maps a RECORD_NOT_ELIGIBLE error to a typed transaction error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "RECORD_NOT_ELIGIBLE" } }));
    const repository = createSupabasePersonalMemoryRecallLogRepository(fakeClient({ rpc }));

    await expect(repository.logTutorRecall(["record-1"])).rejects.toBeInstanceOf(PersonalMemoryRecallLogTransactionError);
  });

  it("wraps an unrecognized error as a generic persistence error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "some raw postgres error" } }));
    const repository = createSupabasePersonalMemoryRecallLogRepository(fakeClient({ rpc }));

    await expect(repository.logTutorRecall(["record-1"])).rejects.toBeInstanceOf(PersonalMemoryRecallLogPersistenceError);
  });
});
