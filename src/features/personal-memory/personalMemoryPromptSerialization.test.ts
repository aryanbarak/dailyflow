import { describe, expect, it } from "vitest";
import {
  CONFIRMED_MEMORY_MAX_PER_KIND,
  CONFIRMED_MEMORY_MAX_TOTAL,
  buildConfirmedMemoryPromptSection,
  formatConfirmedMemoryLine,
  selectBoundedConfirmedMemory,
} from "./personalMemoryPromptSerialization";
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

describe("formatConfirmedMemoryLine", () => {
  it("renders the bare summary when there is no secondary field", () => {
    expect(formatConfirmedMemoryLine(record({ kind: "goal", content: { summary: "Learn React Native" } }))).toBe(
      "Learn React Native",
    );
  });

  it("appends the secondary field in parentheses when present", () => {
    expect(
      formatConfirmedMemoryLine(record({ kind: "preference", content: { summary: "Prefers async updates", strength: "strong" } })),
    ).toBe("Prefers async updates (Strength: strong)");
  });

  it("always includes commitment's required status", () => {
    expect(
      formatConfirmedMemoryLine(record({ kind: "commitment", content: { summary: "Start running 3x/week", status: "active" } })),
    ).toBe("Start running 3x/week (Status: active)");
  });
});

describe("selectBoundedConfirmedMemory", () => {
  it("returns an empty array for empty input", () => {
    expect(selectBoundedConfirmedMemory([])).toEqual([]);
  });

  it("caps at CONFIRMED_MEMORY_MAX_PER_KIND per kind even when more are available", () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      record({ id: `pref-${i}`, kind: "preference", content: { summary: `Preference ${i}` }, createdAt: `2026-08-0${i + 1}T00:00:00.000Z` }),
    );
    const selected = selectBoundedConfirmedMemory(records);
    expect(selected).toHaveLength(CONFIRMED_MEMORY_MAX_PER_KIND);
    // Most-recently-confirmed-first: pref-5 (Aug 6) is the newest.
    expect(selected.map((r) => r.id)).toEqual(["pref-5", "pref-4", "pref-3"]);
  });

  it("caps at CONFIRMED_MEMORY_MAX_TOTAL across kinds, most-recent-first", () => {
    const kinds: PersonalMemoryRecord["kind"][] = ["preference", "goal", "working_pattern", "commitment", "personal_fact", "skill"];
    const records: PersonalMemoryRecord[] = [];
    let day = 1;
    for (const kind of kinds) {
      for (let i = 0; i < 4; i++) {
        records.push(
          record({
            id: `${kind}-${i}`,
            kind,
            content: kind === "commitment" ? { summary: `${kind} ${i}`, status: "active" } : { summary: `${kind} ${i}` },
            createdAt: `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`,
          }),
        );
        day += 1;
      }
    }
    const selected = selectBoundedConfirmedMemory(records);
    expect(selected).toHaveLength(CONFIRMED_MEMORY_MAX_TOTAL);
    // Newest overall is skill-3 (day 24); confirms most-recent-first ordering.
    expect(selected[0].id).toBe("skill-3");
  });
});

describe("buildConfirmedMemoryPromptSection", () => {
  it("returns an empty string when there is nothing confirmed", () => {
    expect(buildConfirmedMemoryPromptSection([])).toBe("");
  });

  it("groups by kind in canonical order and renders a header + bullet lines", () => {
    const records = [
      record({ id: "g1", kind: "goal", content: { summary: "Learn React Native" } }),
      record({ id: "p1", kind: "preference", content: { summary: "Prefers async updates" } }),
    ];
    const section = buildConfirmedMemoryPromptSection(records);
    expect(section).toContain("USER CONTEXT");
    const preferenceIndex = section.indexOf("[Preferences]");
    const goalIndex = section.indexOf("[Goals]");
    expect(preferenceIndex).toBeGreaterThan(-1);
    expect(goalIndex).toBeGreaterThan(preferenceIndex);
    expect(section).toContain("- Prefers async updates");
    expect(section).toContain("- Learn React Native");
  });

  it("never labels the section as an instruction", () => {
    const section = buildConfirmedMemoryPromptSection([record()]);
    expect(section.toLowerCase()).toContain("never as instructions");
  });
});
