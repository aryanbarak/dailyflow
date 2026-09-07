// CORE-W6 (2026-09-07, ADR-0023 SS2): the recall-log service -- owner
// resolution and delegation, mirroring personalMemoryRecordService.test.ts's
// shape.
import { describe, expect, it, vi } from "vitest";
import { createPersonalMemoryRecallLogService } from "./personalMemoryRecallLogService";
import type { PersonalMemoryRecallLogRepository } from "./personalMemoryRecallLogRepository";

function fakeRepository(overrides: Partial<PersonalMemoryRecallLogRepository> = {}): PersonalMemoryRecallLogRepository {
  return {
    listByOwner: vi.fn(async () => []),
    logTutorRecall: vi.fn(async () => ({ recallBatchId: "batch-1" })),
    ...overrides,
  };
}

describe("createPersonalMemoryRecallLogService -- listByOwner", () => {
  it("resolves the owner and delegates to the repository", async () => {
    const listByOwner = vi.fn(async () => []);
    const repository = fakeRepository({ listByOwner });
    const service = createPersonalMemoryRecallLogService({ repository, resolveOwnerId: async () => "user-1" });

    await service.listByOwner();
    expect(listByOwner).toHaveBeenCalledWith("user-1", undefined);
  });

  it("throws UNAUTHENTICATED when no owner is resolved, before touching the repository", async () => {
    const listByOwner = vi.fn();
    const repository = fakeRepository({ listByOwner });
    const service = createPersonalMemoryRecallLogService({ repository, resolveOwnerId: async () => null });

    await expect(service.listByOwner()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(listByOwner).not.toHaveBeenCalled();
  });
});

describe("createPersonalMemoryRecallLogService -- logTutorRecall", () => {
  it("delegates to the repository with a non-empty id list", async () => {
    const logTutorRecall = vi.fn(async () => ({ recallBatchId: "batch-1" }));
    const repository = fakeRepository({ logTutorRecall });
    const service = createPersonalMemoryRecallLogService({ repository, resolveOwnerId: async () => "user-1" });

    const result = await service.logTutorRecall(["record-1"]);
    expect(logTutorRecall).toHaveBeenCalledWith(["record-1"]);
    expect(result).toEqual({ recallBatchId: "batch-1" });
  });

  it("rejects an empty id list before touching the repository", async () => {
    const logTutorRecall = vi.fn();
    const repository = fakeRepository({ logTutorRecall });
    const service = createPersonalMemoryRecallLogService({ repository, resolveOwnerId: async () => "user-1" });

    await expect(service.logTutorRecall([])).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(logTutorRecall).not.toHaveBeenCalled();
  });
});
