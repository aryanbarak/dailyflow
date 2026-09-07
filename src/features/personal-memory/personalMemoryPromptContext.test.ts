import { describe, expect, it, vi } from "vitest";
import { getConfirmedMemoryPromptContext } from "./personalMemoryPromptContext";
import type { PersonalMemoryRecord } from "./personalMemoryRecordTypes";

function record(overrides: Partial<PersonalMemoryRecord> = {}): PersonalMemoryRecord {
  return {
    id: "record-1",
    ownerId: "owner-1",
    kind: "preference",
    content: { summary: "Prefers async written updates" },
    provenance: { sourceKind: "chat_turn", sourceReferenceIds: ["22222222-2222-4222-8222-222222222222"] },
    modelIdentity: "gemini",
    derivationVersion: "personal-memory-extraction-v1",
    confidence: "high",
    status: "user_confirmed",
    source: "model",
    contentFingerprint: "a".repeat(64),
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getConfirmedMemoryPromptContext", () => {
  it("formats the service's confirmed records into the prompt section, and returns their ids", async () => {
    const service = { listConfirmed: vi.fn(async () => [record()]) };
    const result = await getConfirmedMemoryPromptContext(service);
    expect(result.text).toContain("Prefers async written updates");
    expect(result.recordIds).toEqual(["record-1"]);
    expect(service.listConfirmed).toHaveBeenCalledTimes(1);
  });

  it("returns an empty string and no ids when the service has nothing confirmed -- no section, not an empty header", async () => {
    const service = { listConfirmed: vi.fn(async () => []) };
    const result = await getConfirmedMemoryPromptContext(service);
    expect(result.text).toBe("");
    expect(result.recordIds).toEqual([]);
  });

  it("recordIds reflects the bounded selection, not every confirmed record", async () => {
    const kinds: PersonalMemoryRecord["kind"][] = [
      "preference", "goal", "working_pattern", "commitment", "personal_fact", "skill",
    ];
    const records = Array.from({ length: 12 }, (_, i) =>
      record({
        id: `record-${i}`,
        kind: kinds[i % kinds.length],
        createdAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );
    const service = { listConfirmed: vi.fn(async () => records) };
    const result = await getConfirmedMemoryPromptContext(service);
    expect(result.recordIds).toHaveLength(10);
    expect(result.recordIds).toContain("record-11");
    expect(result.recordIds).not.toContain("record-0");
  });

  it("propagates a service error rather than swallowing it", async () => {
    const service = { listConfirmed: vi.fn(async () => { throw new Error("boom"); }) };
    await expect(getConfirmedMemoryPromptContext(service)).rejects.toThrow("boom");
  });
});
