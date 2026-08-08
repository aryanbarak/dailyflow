import { describe, expect, it } from "vitest";
import {
  computePersonalMemoryContentFingerprint,
  isSupportedPersonalMemoryConfidence,
  isSupportedPersonalMemoryRecordKind,
  isSupportedProvenanceSourceKind,
  validatePersonalMemoryContent,
  validateProvenanceSourceReferenceIds,
} from "./personalMemoryRecordValidation";

const CHAT_ID = "22222222-2222-4222-8222-222222222222";

describe("validatePersonalMemoryContent -- per-kind shape rules", () => {
  it("accepts a well-formed preference", () => {
    const result = validatePersonalMemoryContent("preference", { summary: "Prefers async written updates", strength: "strong" });
    expect(result).toEqual({ valid: true, value: { summary: "Prefers async written updates", strength: "strong" } });
  });

  it("accepts a preference with the optional field omitted", () => {
    const result = validatePersonalMemoryContent("preference", { summary: "Prefers short meetings" });
    expect(result).toEqual({ valid: true, value: { summary: "Prefers short meetings" } });
  });

  it("rejects a preference with an empty summary", () => {
    const result = validatePersonalMemoryContent("preference", { summary: "" });
    expect(result.valid).toBe(false);
  });

  it("rejects a preference with an unsupported strength value", () => {
    const result = validatePersonalMemoryContent("preference", { summary: "x", strength: "extreme" });
    expect(result.valid).toBe(false);
  });

  it("rejects an unrecognized field", () => {
    const result = validatePersonalMemoryContent("preference", { summary: "x", unexpected: "y" });
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed goal", () => {
    const result = validatePersonalMemoryContent("goal", { summary: "Learn React Native", timeframe: "long_term" });
    expect(result).toEqual({ valid: true, value: { summary: "Learn React Native", timeframe: "long_term" } });
  });

  it("accepts a well-formed working_pattern", () => {
    const result = validatePersonalMemoryContent("working_pattern", { summary: "Reviews PRs in the morning", frequency: "daily" });
    expect(result).toEqual({ valid: true, value: { summary: "Reviews PRs in the morning", frequency: "daily" } });
  });

  it("requires commitment.status (not optional, unlike the other kinds' secondary field)", () => {
    const missing = validatePersonalMemoryContent("commitment", { summary: "Start running 3x/week" });
    expect(missing.valid).toBe(false);
    const present = validatePersonalMemoryContent("commitment", { summary: "Start running 3x/week", status: "active" });
    expect(present).toEqual({ valid: true, value: { summary: "Start running 3x/week", status: "active" } });
  });

  it("accepts a well-formed personal_fact", () => {
    const result = validatePersonalMemoryContent("personal_fact", { summary: "Prefers to be called Aryan", category: "identity" });
    expect(result).toEqual({ valid: true, value: { summary: "Prefers to be called Aryan", category: "identity" } });
  });

  it("accepts a well-formed skill", () => {
    const result = validatePersonalMemoryContent("skill", { summary: "Learning algorithms", level: "beginner" });
    expect(result).toEqual({ valid: true, value: { summary: "Learning algorithms", level: "beginner" } });
  });

  it("rejects non-plain-object content", () => {
    expect(validatePersonalMemoryContent("preference", "just a string").valid).toBe(false);
    expect(validatePersonalMemoryContent("preference", ["array"]).valid).toBe(false);
    expect(validatePersonalMemoryContent("preference", null).valid).toBe(false);
  });
});

describe("validatePersonalMemoryContent -- sensitive-category defense in depth (ADR-0010 Q2)", () => {
  const sensitiveFixtures: ReadonlyArray<{ label: string; kind: Parameters<typeof validatePersonalMemoryContent>[0]; content: unknown }> = [
    { label: "health", kind: "personal_fact", content: { summary: "Was diagnosed with anxiety last year" } },
    { label: "medication", kind: "personal_fact", content: { summary: "Takes medication every morning" } },
    { label: "family", kind: "personal_fact", content: { summary: "Has two kids in elementary school" } },
    { label: "spouse", kind: "preference", content: { summary: "My husband prefers we eat dinner early" } },
    { label: "emotional state", kind: "working_pattern", content: { summary: "Feels overwhelmed and stressed most weeks" } },
    { label: "mood", kind: "goal", content: { summary: "Wants to improve my mood this year" } },
    // Review finding MAJOR #2 (2026-08-personal-memory-layer-review.md,
    // section B) -- these two exact payloads previously passed validation
    // undetected. Fixed by extending SENSITIVE_CONTENT_PATTERNS with
    // family-noun and keyword-less-medical-phrasing coverage.
    { label: "daughter (proven bypass, review MAJOR #2)", kind: "personal_fact", content: { summary: "My daughter starts kindergarten this fall" } },
    { label: "checkup (proven bypass, review MAJOR #2)", kind: "commitment", content: { summary: "Annual checkup next month", status: "active" } },
    { label: "son (neighbor)", kind: "personal_fact", content: { summary: "My son just started high school" } },
    { label: "dentist appointment (neighbor)", kind: "commitment", content: { summary: "Dentist appointment next Tuesday", status: "active" } },
    { label: "grandmother (neighbor)", kind: "personal_fact", content: { summary: "Visiting my grandmother next weekend" } },
  ];

  it.each(sensitiveFixtures)("rejects $label content even under an approved kind ($kind)", ({ kind, content }) => {
    const result = validatePersonalMemoryContent(kind, content);
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.errors.some((issue) => issue.code === "SENSITIVE_CONTENT_EXCLUDED")).toBe(true);
    }
  });

  it("does not reject legitimate content that merely shares no overlap with the sensitive heuristic", () => {
    const result = validatePersonalMemoryContent("goal", { summary: "Wants to complete the IHK Fachinformatiker exam" });
    expect(result.valid).toBe(true);
  });
});

describe("kind/confidence/provenance-source-kind guards", () => {
  it("isSupportedPersonalMemoryRecordKind accepts exactly the six approved kinds", () => {
    for (const kind of ["preference", "goal", "working_pattern", "commitment", "personal_fact", "skill"]) {
      expect(isSupportedPersonalMemoryRecordKind(kind)).toBe(true);
    }
    expect(isSupportedPersonalMemoryRecordKind("health_note")).toBe(false);
    expect(isSupportedPersonalMemoryRecordKind("family_note")).toBe(false);
  });

  it("isSupportedPersonalMemoryConfidence accepts exactly low/medium/high", () => {
    expect(isSupportedPersonalMemoryConfidence("low")).toBe(true);
    expect(isSupportedPersonalMemoryConfidence("extreme")).toBe(false);
  });

  it("isSupportedProvenanceSourceKind accepts all three data-model values (including explicit_user_statement, unreachable via any write path in this task)", () => {
    expect(isSupportedProvenanceSourceKind("chat_turn")).toBe(true);
    expect(isSupportedProvenanceSourceKind("briefing")).toBe(true);
    expect(isSupportedProvenanceSourceKind("explicit_user_statement")).toBe(true);
    expect(isSupportedProvenanceSourceKind("email")).toBe(false);
  });
});

describe("validateProvenanceSourceReferenceIds -- non-empty by construction (ADR-0010 Decision section 1)", () => {
  it("rejects an empty array", () => {
    expect(validateProvenanceSourceReferenceIds([])).toBeNull();
  });

  it("rejects a non-array", () => {
    expect(validateProvenanceSourceReferenceIds(CHAT_ID)).toBeNull();
  });

  it("rejects an array containing a non-UUID string", () => {
    expect(validateProvenanceSourceReferenceIds([CHAT_ID, "not-a-uuid"])).toBeNull();
  });

  it("accepts a bounded array of valid UUIDs", () => {
    expect(validateProvenanceSourceReferenceIds([CHAT_ID])).toEqual([CHAT_ID]);
  });

  it("rejects more than the maximum allowed reference ids", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `2222222${(i % 10)}-2222-4222-8222-22222222222${i % 10}`);
    expect(validateProvenanceSourceReferenceIds(tooMany)).toBeNull();
  });
});

describe("computePersonalMemoryContentFingerprint", () => {
  it("is deterministic and independent of key insertion order", async () => {
    const a = await computePersonalMemoryContentFingerprint("preference", { summary: "x", strength: "strong" });
    const b = await computePersonalMemoryContentFingerprint("preference", { strength: "strong", summary: "x" } as never);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when the kind differs, even with identical content", async () => {
    const a = await computePersonalMemoryContentFingerprint("preference", { summary: "x" });
    const b = await computePersonalMemoryContentFingerprint("goal", { summary: "x" });
    expect(a).not.toBe(b);
  });
});
