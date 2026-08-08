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
  it("formats the service's confirmed records into the prompt section", async () => {
    const service = { listConfirmed: vi.fn(async () => [record()]) };
    const result = await getConfirmedMemoryPromptContext(service);
    expect(result).toContain("Prefers async written updates");
    expect(service.listConfirmed).toHaveBeenCalledTimes(1);
  });

  it("returns an empty string when the service has nothing confirmed -- no section, not an empty header", async () => {
    const service = { listConfirmed: vi.fn(async () => []) };
    const result = await getConfirmedMemoryPromptContext(service);
    expect(result).toBe("");
  });

  it("propagates a service error rather than swallowing it", async () => {
    const service = { listConfirmed: vi.fn(async () => { throw new Error("boom"); }) };
    await expect(getConfirmedMemoryPromptContext(service)).rejects.toThrow("boom");
  });
});
