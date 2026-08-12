import { describe, expect, it, vi } from "vitest";
import { createPersonalMemoryRecordService } from "./personalMemoryRecordService";
import { PersonalMemoryRecordError } from "./personalMemoryRecordTypes";
import type { PersonalMemoryRecord } from "./personalMemoryRecordTypes";
import type { PersonalMemoryRecordRepository } from "./personalMemoryRecordRepository";

const CHAT_ID = "22222222-2222-4222-8222-222222222222";

function proposedRecord(overrides: Partial<PersonalMemoryRecord> = {}): PersonalMemoryRecord {
  return {
    id: "record-1",
    ownerId: "user-1",
    runId: "run-1",
    kind: "preference",
    content: { summary: "Prefers async written updates" },
    provenance: { sourceKind: "chat_turn", sourceReferenceIds: [CHAT_ID] },
    modelIdentity: "gemini-test",
    derivationVersion: "personal-memory-extraction-v1",
    confidence: "medium",
    status: "proposed",
    source: "model",
    contentFingerprint: "a".repeat(64),
    createdAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function fakeRepository(overrides: Partial<PersonalMemoryRecordRepository> = {}): PersonalMemoryRecordRepository {
  return {
    insert: vi.fn(),
    resolve: vi.fn(),
    confirmUpdate: vi.fn(),
    remove: vi.fn(),
    findById: vi.fn(async () => null),
    listByOwner: vi.fn(async () => []),
    listConfirmedByOwner: vi.fn(async () => []),
    createRun: vi.fn(),
    completeRun: vi.fn(),
    ...overrides,
  };
}

describe("createPersonalMemoryRecordService -- create", () => {
  it("throws UNAUTHENTICATED when no owner is resolved, before touching the repository", async () => {
    const repository = fakeRepository();
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => null });

    await expect(
      service.create({
        runId: "run-1",
        kind: "preference",
        content: { summary: "x" },
        provenance: { sourceKind: "chat_turn", sourceReferenceIds: [CHAT_ID] },
        modelIdentity: "m",
        derivationVersion: "v1",
        confidence: "low",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects create input that fails per-kind content validation before ever reaching the repository", async () => {
    const repository = fakeRepository();
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    await expect(
      service.create({
        runId: "run-1",
        kind: "preference",
        content: { summary: "x", strength: "not-a-real-strength" },
        provenance: { sourceKind: "chat_turn", sourceReferenceIds: [CHAT_ID] },
        modelIdentity: "m",
        derivationVersion: "v1",
        confidence: "low",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects create input with sensitive content before ever reaching the repository (defense in depth)", async () => {
    const repository = fakeRepository();
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    await expect(
      service.create({
        runId: "run-1",
        kind: "personal_fact",
        content: { summary: "Was diagnosed with anxiety last year" },
        provenance: { sourceKind: "chat_turn", sourceReferenceIds: [CHAT_ID] },
        modelIdentity: "m",
        derivationVersion: "v1",
        confidence: "low",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects empty provenance reference ids", async () => {
    const repository = fakeRepository();
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    await expect(
      service.create({
        runId: "run-1",
        kind: "preference",
        content: { summary: "x" },
        provenance: { sourceKind: "chat_turn", sourceReferenceIds: [] },
        modelIdentity: "m",
        derivationVersion: "v1",
        confidence: "low",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("calls the repository with validated input on success", async () => {
    const insert = vi.fn(async () => ({ outcome: "created" as const, record: proposedRecord() }));
    const repository = fakeRepository({ insert });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    const result = await service.create({
      runId: "run-1",
      kind: "preference",
      content: { summary: "Prefers async written updates" },
      provenance: { sourceKind: "chat_turn", sourceReferenceIds: [CHAT_ID] },
      modelIdentity: "gemini-test",
      derivationVersion: "v1",
      confidence: "medium",
    });
    expect(result.outcome).toBe("created");
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe("createPersonalMemoryRecordService -- resolve", () => {
  it("rejects resolving a record that is not proposed", async () => {
    const repository = fakeRepository({ findById: vi.fn(async () => proposedRecord({ status: "user_confirmed" })) });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    await expect(service.resolve({ recordId: "record-1", action: "confirm" })).rejects.toMatchObject({ code: "RECORD_NOT_PROPOSED" });
    expect(repository.resolve).not.toHaveBeenCalled();
  });

  it("rejects a correct action with invalid corrected content before touching the repository", async () => {
    const repository = fakeRepository({ findById: vi.fn(async () => proposedRecord()) });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    await expect(
      service.resolve({ recordId: "record-1", action: "correct", correctedContent: { summary: "" } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repository.resolve).not.toHaveBeenCalled();
  });

  it("computes the corrected content fingerprint and delegates to the repository for a valid correction", async () => {
    const resolve = vi.fn(async () => ({
      outcome: "user_corrected" as const,
      record: proposedRecord({ id: "record-2", source: "user", supersedesId: "record-1", status: "user_confirmed" }),
    }));
    const repository = fakeRepository({ findById: vi.fn(async () => proposedRecord()), resolve });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    const result = await service.resolve({ recordId: "record-1", action: "correct", correctedContent: { summary: "Updated summary" } });
    expect(result.outcome).toBe("user_corrected");
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ recordId: "record-1", action: "correct" }),
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
  });
});

describe("createPersonalMemoryRecordService -- confirmUpdate (task 18, B2/B3)", () => {
  it("delegates to the repository with the candidate and superseded ids", async () => {
    const confirmUpdate = vi.fn(async () => ({
      outcome: "update_confirmed" as const,
      candidate: proposedRecord({ id: "candidate-1", status: "user_confirmed", supersedesId: "old-1" }),
      superseded: proposedRecord({ id: "old-1", status: "superseded", supersededById: "candidate-1", supersededAt: "2026-08-12T00:00:00.000Z" }),
    }));
    const repository = fakeRepository({ confirmUpdate });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    const result = await service.confirmUpdate({ candidateRecordId: "candidate-1", supersededRecordId: "old-1" });

    expect(result.outcome).toBe("update_confirmed");
    expect(confirmUpdate).toHaveBeenCalledWith({ candidateRecordId: "candidate-1", supersededRecordId: "old-1" });
  });

  it("rejects a record superseding itself before ever touching the repository", async () => {
    const repository = fakeRepository();
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    await expect(service.confirmUpdate({ candidateRecordId: "same-id", supersededRecordId: "same-id" })).rejects.toBeInstanceOf(PersonalMemoryRecordError);
    expect(repository.confirmUpdate).not.toHaveBeenCalled();
  });

  it("throws UNAUTHENTICATED when no owner is resolved, before touching the repository", async () => {
    const repository = fakeRepository();
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => null });

    await expect(service.confirmUpdate({ candidateRecordId: "a", supersededRecordId: "b" })).rejects.toBeInstanceOf(PersonalMemoryRecordError);
    expect(repository.confirmUpdate).not.toHaveBeenCalled();
  });
});

describe("createPersonalMemoryRecordService -- remove (ADR-0010 Q1)", () => {
  it("delegates to the repository without requiring the record to be proposed", async () => {
    const remove = vi.fn(async () => ({ outcome: "deleted" as const, id: "record-1" }));
    const repository = fakeRepository({ remove });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    const result = await service.remove("record-1");
    expect(result).toEqual({ outcome: "deleted", id: "record-1" });
    expect(remove).toHaveBeenCalledWith("record-1");
  });

  it("throws UNAUTHENTICATED when no owner is resolved, before touching the repository", async () => {
    const repository = fakeRepository();
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => null });

    await expect(service.remove("record-1")).rejects.toBeInstanceOf(PersonalMemoryRecordError);
    expect(repository.remove).not.toHaveBeenCalled();
  });
});

describe("createPersonalMemoryRecordService -- listByOwner", () => {
  it("lists strictly the resolved owner's own records, no project dimension", async () => {
    const listByOwner = vi.fn(async () => [proposedRecord()]);
    const repository = fakeRepository({ listByOwner });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    const result = await service.listByOwner();
    expect(result).toHaveLength(1);
    expect(listByOwner).toHaveBeenCalledWith("user-1");
  });
});

describe("createPersonalMemoryRecordService -- listConfirmed (ADR-0011)", () => {
  it("delegates to the repository's status-filtered read for the resolved owner", async () => {
    const listConfirmedByOwner = vi.fn(async () => [proposedRecord({ status: "user_confirmed" })]);
    const repository = fakeRepository({ listConfirmedByOwner });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => "user-1" });

    const result = await service.listConfirmed();
    expect(result).toHaveLength(1);
    expect(listConfirmedByOwner).toHaveBeenCalledWith("user-1");
  });

  it("throws UNAUTHENTICATED when no owner is resolved, before touching the repository", async () => {
    const listConfirmedByOwner = vi.fn();
    const repository = fakeRepository({ listConfirmedByOwner });
    const service = createPersonalMemoryRecordService({ repository, resolveOwnerId: async () => null });

    await expect(service.listConfirmed()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(listConfirmedByOwner).not.toHaveBeenCalled();
  });
});
