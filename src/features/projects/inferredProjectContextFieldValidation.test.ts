import { describe, expect, it } from "vitest";
import {
  computeInferredFieldContentFingerprint,
  isSupportedInferredContextFieldKind,
  isSupportedInferredFieldConfidence,
  validateInferredFieldContent,
  validateSourceEvidenceIds,
} from "./inferredProjectContextFieldValidation";

describe("validateInferredFieldContent", () => {
  it("accepts a valid objective and rejects an unsupported status", () => {
    const ok = validateInferredFieldContent("objective", { summary: "Ship v1", status: "active" });
    expect(ok.valid).toBe(true);
    const bad = validateInferredFieldContent("objective", { summary: "Ship v1", status: "in_progress" });
    expect(bad.valid).toBe(false);
  });

  it("accepts a valid milestone with optional order and completedAt", () => {
    const result = validateInferredFieldContent("milestone", {
      title: "Beta launch",
      status: "completed",
      order: 3,
      completedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an unknown field on any kind (fails closed, never silently drops it)", () => {
    const result = validateInferredFieldContent("risk", { summary: "x", severity: "low", extra: "nope" });
    expect(result.valid).toBe(false);
  });

  it("rejects content that is not a plain object", () => {
    expect(validateInferredFieldContent("decision", "not-an-object").valid).toBe(false);
    expect(validateInferredFieldContent("decision", null).valid).toBe(false);
    expect(validateInferredFieldContent("decision", ["a"]).valid).toBe(false);
  });

  it("validates capability and candidate_action shapes", () => {
    expect(validateInferredFieldContent("capability", { title: "Auth", status: "implemented" }).valid).toBe(true);
    expect(validateInferredFieldContent("candidate_action", { summary: "Add tests" }).valid).toBe(true);
    expect(validateInferredFieldContent("candidate_action", { summary: "" }).valid).toBe(false);
  });

  it("rejects an overlong string field rather than silently truncating it", () => {
    const result = validateInferredFieldContent("risk", { summary: "x".repeat(600), severity: "high" });
    expect(result.valid).toBe(false);
  });
});

describe("isSupportedInferredContextFieldKind / isSupportedInferredFieldConfidence", () => {
  it("accepts exactly the closed set and rejects anything else", () => {
    expect(isSupportedInferredContextFieldKind("objective")).toBe(true);
    expect(isSupportedInferredContextFieldKind("candidate_action")).toBe(true);
    expect(isSupportedInferredContextFieldKind("unknown_kind")).toBe(false);
    expect(isSupportedInferredFieldConfidence("medium")).toBe(true);
    expect(isSupportedInferredFieldConfidence("0.75")).toBe(false);
  });
});

describe("validateSourceEvidenceIds", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("accepts a non-empty array of valid UUIDs, up to the maximum", () => {
    expect(validateSourceEvidenceIds([uuid])).toEqual([uuid]);
  });

  it("rejects an empty array -- an inference with no evidence linkage is invalid by construction", () => {
    expect(validateSourceEvidenceIds([])).toBeNull();
  });

  it("rejects a non-array, a non-UUID entry, and more than 20 entries", () => {
    expect(validateSourceEvidenceIds("not-an-array")).toBeNull();
    expect(validateSourceEvidenceIds([uuid, "not-a-uuid"])).toBeNull();
    expect(validateSourceEvidenceIds(new Array(21).fill(uuid))).toBeNull();
  });
});

describe("computeInferredFieldContentFingerprint", () => {
  it("is deterministic and independent of object key order", async () => {
    const a = await computeInferredFieldContentFingerprint("risk", { summary: "x", severity: "low" });
    const b = await computeInferredFieldContentFingerprint("risk", { severity: "low", summary: "x" });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs when kind differs, even with identical content shape values", async () => {
    const objective = await computeInferredFieldContentFingerprint("objective", { summary: "x", status: "active" });
    // Different kind entirely -- a risk's shape doesn't overlap objective's, but the point is kind is part of the hash input.
    const risk = await computeInferredFieldContentFingerprint("risk", { summary: "x", severity: "low" } as never);
    expect(objective).not.toBe(risk);
  });

  it("differs when content differs", async () => {
    const a = await computeInferredFieldContentFingerprint("risk", { summary: "x", severity: "low" });
    const b = await computeInferredFieldContentFingerprint("risk", { summary: "y", severity: "low" });
    expect(a).not.toBe(b);
  });
});
