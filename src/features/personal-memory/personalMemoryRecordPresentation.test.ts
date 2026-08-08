import { describe, expect, it } from "vitest";
import {
  buildPersonalMemoryContentFromForm,
  groupVisiblePersonalMemoryRecords,
  isPersonalMemoryRecordActionable,
  personalMemoryDisplayStatusHelpText,
  personalMemoryFormInitialValues,
  personalMemoryRecordDisplayStatus,
  personalMemoryRecordPrimaryText,
  personalMemoryRecordSecondaryText,
} from "./personalMemoryRecordPresentation";
import type { PersonalMemoryRecord } from "./personalMemoryRecordTypes";

function record(overrides: Partial<PersonalMemoryRecord> = {}): PersonalMemoryRecord {
  return {
    id: "record-1",
    ownerId: "owner-1",
    runId: "run-1",
    kind: "preference",
    content: { summary: "Prefers async written updates", strength: "strong" },
    provenance: { sourceKind: "chat_turn", sourceReferenceIds: ["22222222-2222-4222-8222-222222222222"] },
    modelIdentity: "gemini",
    derivationVersion: "personal-memory-extraction-v1",
    confidence: "high",
    status: "proposed",
    source: "model",
    contentFingerprint: "a".repeat(64),
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("personalMemoryRecordDisplayStatus / isPersonalMemoryRecordActionable", () => {
  it("marks a proposed model row as proposed and actionable", () => {
    const r = record({ status: "proposed", source: "model" });
    expect(personalMemoryRecordDisplayStatus(r)).toBe("proposed");
    expect(isPersonalMemoryRecordActionable(r)).toBe(true);
  });

  it("marks a plain confirmed row (same model row) as confirmed, not actionable", () => {
    const r = record({ status: "user_confirmed", source: "model" });
    expect(personalMemoryRecordDisplayStatus(r)).toBe("confirmed");
    expect(isPersonalMemoryRecordActionable(r)).toBe(false);
  });

  it("distinguishes a correction's new row (source=user, supersedesId set) as corrected, not confirmed", () => {
    const r = record({ status: "user_confirmed", source: "user", supersedesId: "record-original" });
    expect(personalMemoryRecordDisplayStatus(r)).toBe("corrected");
    expect(isPersonalMemoryRecordActionable(r)).toBe(false);
  });

  it("never treats a user_confirmed row with source=user but no supersedesId as corrected", () => {
    const r = record({ status: "user_confirmed", source: "user" });
    expect(personalMemoryRecordDisplayStatus(r)).toBe("confirmed");
  });

  it("hides the pre-correction original row (status=user_corrected) -- never shown as its own entry", () => {
    const r = record({ status: "user_corrected", source: "model" });
    expect(personalMemoryRecordDisplayStatus(r)).toBeNull();
    expect(isPersonalMemoryRecordActionable(r)).toBe(false);
  });

  it("returns 'rejected' for a user_rejected row (visible only behind the show-rejected toggle -- see groupVisiblePersonalMemoryRecords)", () => {
    const r = record({ status: "user_rejected" });
    expect(personalMemoryRecordDisplayStatus(r)).toBe("rejected");
  });

  it("hides a superseded row (unreachable in v1 -- no automatic supersession -- but must not crash)", () => {
    const r = record({ status: "superseded" });
    expect(personalMemoryRecordDisplayStatus(r)).toBeNull();
  });
});

describe("personalMemoryDisplayStatusHelpText", () => {
  it("names the Q5 zero-consumption guarantee for proposed records", () => {
    expect(personalMemoryDisplayStatusHelpText("proposed")).toMatch(/not used anywhere/i);
  });

  it("names the Q1/Q5 duplicate-suppression-survives-rejection rule for rejected records", () => {
    expect(personalMemoryDisplayStatusHelpText("rejected")).toMatch(/prevents this same fact/i);
  });

  it("has no help text for confirmed or corrected records", () => {
    expect(personalMemoryDisplayStatusHelpText("confirmed")).toBeUndefined();
    expect(personalMemoryDisplayStatusHelpText("corrected")).toBeUndefined();
  });
});

describe("groupVisiblePersonalMemoryRecords", () => {
  it("excludes hidden statuses, groups by kind in canonical order, newest first, and hides rejected by default", () => {
    const records: PersonalMemoryRecord[] = [
      record({ id: "g1", kind: "goal", status: "proposed", createdAt: "2026-08-01T00:00:00.000Z" }),
      record({ id: "g2", kind: "goal", status: "proposed", createdAt: "2026-08-02T00:00:00.000Z" }),
      record({ id: "p1", kind: "preference", status: "user_confirmed", source: "model", createdAt: "2026-08-01T00:00:00.000Z" }),
      record({ id: "rej", kind: "goal", status: "user_rejected", createdAt: "2026-08-03T00:00:00.000Z" }),
      record({ id: "sup", kind: "goal", status: "superseded", createdAt: "2026-08-03T00:00:00.000Z" }),
      record({ id: "orig", kind: "goal", status: "user_corrected", source: "model", createdAt: "2026-08-03T00:00:00.000Z" }),
    ];

    const grouped = groupVisiblePersonalMemoryRecords(records);

    expect(grouped.map((g) => g.kind)).toEqual(["preference", "goal"]);
    expect(grouped.find((g) => g.kind === "goal")?.entries.map((e) => e.record.id)).toEqual(["g2", "g1"]);
    expect(grouped.find((g) => g.kind === "preference")?.entries.map((e) => e.record.id)).toEqual(["p1"]);
  });

  it("includes rejected records only when showRejected is true", () => {
    const records = [record({ id: "rej", kind: "goal", status: "user_rejected" })];

    expect(groupVisiblePersonalMemoryRecords(records)).toEqual([]);
    const shown = groupVisiblePersonalMemoryRecords(records, { showRejected: true });
    expect(shown.find((g) => g.kind === "goal")?.entries.map((e) => e.record.id)).toEqual(["rej"]);
  });

  it("attaches the pre-correction original to its correction's display entry, never as a separate entry", () => {
    const original = record({ id: "orig", kind: "goal", status: "user_corrected", source: "model", content: { summary: "Original summary" } });
    const correction = record({ id: "corr", kind: "goal", status: "user_confirmed", source: "user", supersedesId: "orig", content: { summary: "Corrected summary" } });

    const grouped = groupVisiblePersonalMemoryRecords([original, correction]);
    const goalEntries = grouped.find((g) => g.kind === "goal")?.entries ?? [];

    expect(goalEntries.map((e) => e.record.id)).toEqual(["corr"]);
    expect(goalEntries[0].displayStatus).toBe("corrected");
    expect(goalEntries[0].originalRecord?.id).toBe("orig");
  });

  it("returns an empty array when nothing is visible", () => {
    const records = [record({ status: "user_corrected", source: "model" }), record({ status: "superseded" })];
    expect(groupVisiblePersonalMemoryRecords(records)).toEqual([]);
  });
});

describe("personalMemoryRecordPrimaryText / personalMemoryRecordSecondaryText", () => {
  it("reads summary as the primary text for every kind", () => {
    expect(personalMemoryRecordPrimaryText({ summary: "Learn React Native" })).toBe("Learn React Native");
  });

  it("formats a kind-specific secondary line, or omits one when the optional field is absent", () => {
    expect(personalMemoryRecordSecondaryText("preference", { summary: "x", strength: "strong" })).toBe("Strength: strong");
    expect(personalMemoryRecordSecondaryText("commitment", { summary: "x", status: "active" })).toBe("Status: active");
    expect(personalMemoryRecordSecondaryText("goal", { summary: "x" })).toBeUndefined();
  });
});

describe("form value <-> content conversion", () => {
  it("pre-fills form values from existing content", () => {
    const values = personalMemoryFormInitialValues("preference", { summary: "Prefers async updates", strength: "strong" });
    expect(values).toEqual({ summary: "Prefers async updates", strength: "strong" });
  });

  it("omits empty fields rather than fabricating a value", () => {
    const content = buildPersonalMemoryContentFromForm("preference", { summary: "Prefers async updates", strength: "" });
    expect(content).toEqual({ summary: "Prefers async updates" });
  });

  it("round-trips commitment content through initial-values and back", () => {
    const original = { summary: "Start running 3x/week", status: "active" };
    const values = personalMemoryFormInitialValues("commitment", original);
    const rebuilt = buildPersonalMemoryContentFromForm("commitment", values);
    expect(rebuilt).toEqual(original);
  });
});
