import { describe, expect, it } from "vitest";
import {
  AI_TRAINING_EXAMPLE_SOURCES,
  AI_TRAINING_PRIVACY_STATUSES,
  collectAiTrainingExampleErrors,
  isExportableForTraining,
  isValidAiTrainingExample,
  type AiTrainingExampleV1,
} from "./aiLearningTrainingExample";

const VALID_EXAMPLE: AiTrainingExampleV1 = {
  exampleId: "ex-1",
  schemaVersion: "training-example-v1",
  learningTask: "intent_routing_v1",
  source: "synthetic",
  language: "de",
  input: "Erstelle morgen um 10 Uhr eine Aufgabe: Ahmad anrufen",
  expectedOutput: {
    schemaVersion: "intent-routing-v1",
    language: "de",
    interactionClass: "write",
    domain: "calendar",
    intentType: "create_calendar_event",
    toolId: "calendar.create_event",
    requiresClarification: false,
    requiresApproval: true,
  },
  confidence: "validated",
  privacyStatus: "cleared_for_export",
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("training-example vs eval-fixture separation", () => {
  it("uses its own distinct schemaVersion literal, never intent-routing-v1's own", () => {
    expect(VALID_EXAMPLE.schemaVersion).toBe("training-example-v1");
    expect(collectAiTrainingExampleErrors({ ...VALID_EXAMPLE, schemaVersion: "intent-routing-v1" }).length).toBeGreaterThan(0);
  });
});

describe("AiTrainingExampleV1 validation", () => {
  it("accepts a fully valid example", () => {
    expect(isValidAiTrainingExample(VALID_EXAMPLE)).toBe(true);
    expect(collectAiTrainingExampleErrors(VALID_EXAMPLE)).toEqual([]);
  });

  it("fixes the four training-example sources", () => {
    expect(AI_TRAINING_EXAMPLE_SOURCES).toEqual(["synthetic", "real_user", "corrected", "execution_verified"]);
  });

  it("fixes the three privacy statuses", () => {
    expect(AI_TRAINING_PRIVACY_STATUSES).toEqual(["unreviewed", "sanitized", "cleared_for_export"]);
  });

  it("rejects an unknown source or privacyStatus", () => {
    expect(collectAiTrainingExampleErrors({ ...VALID_EXAMPLE, source: "bogus" }).length).toBeGreaterThan(0);
    expect(collectAiTrainingExampleErrors({ ...VALID_EXAMPLE, privacyStatus: "bogus" }).length).toBeGreaterThan(0);
  });

  it("propagates expectedOutput validation errors with a prefix identifying the nested field", () => {
    const errors = collectAiTrainingExampleErrors({ ...VALID_EXAMPLE, expectedOutput: { ...VALID_EXAMPLE.expectedOutput, domain: "bogus" } });
    expect(errors.some((e) => e.startsWith("expectedOutput:"))).toBe(true);
  });

  it("rejects a non-ISO createdAt", () => {
    expect(collectAiTrainingExampleErrors({ ...VALID_EXAMPLE, createdAt: "yesterday" }).length).toBeGreaterThan(0);
  });

  // I. example.language='de', expectedOutput.language='fa' -> INVALID example.
  describe("language/expectedOutput.language consistency (architectural review correction, round 3)", () => {
    it("I: rejects an example whose own language does not match expectedOutput.language", () => {
      const errors = collectAiTrainingExampleErrors({
        ...VALID_EXAMPLE,
        language: "de",
        expectedOutput: { ...VALID_EXAMPLE.expectedOutput, language: "fa" },
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("language") && e.includes("expectedOutput.language"))).toBe(true);
    });

    it("accepts an example whose language matches expectedOutput.language", () => {
      expect(collectAiTrainingExampleErrors(VALID_EXAMPLE)).toEqual([]);
    });
  });

  // ARCHITECTURAL REVIEW CORRECTION (round 4): AiTrainingExampleV1 is a
  // CLOSED top-level shape -- exactly the ten declared keys are allowed;
  // any other top-level field is rejected, mirroring
  // shared/aiLearning.ts's own IntentRoutingLearningPayloadV1 correction.
  describe("closed-schema enforcement (no unknown top-level keys)", () => {
    // 1. access_token extra field rejected.
    it("1: rejects a valid example carrying an extra access_token field", () => {
      const errors = collectAiTrainingExampleErrors({ ...VALID_EXAMPLE, access_token: "leaked-value" });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("access_token"))).toBe(true);
    });

    // 2. arbitrary metadata extra field rejected.
    it("2: rejects a valid example carrying an extra rawMetadata field", () => {
      const errors = collectAiTrainingExampleErrors({ ...VALID_EXAMPLE, rawMetadata: { anything: "goes here" } });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("rawMetadata"))).toBe(true);
    });

    it("rejects a valid example carrying an arbitrary nested field under an unrecognized top-level key", () => {
      const errors = collectAiTrainingExampleErrors({ ...VALID_EXAMPLE, debugContext: { nested: { deeply: "irrelevant" } } });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("debugContext"))).toBe(true);
    });

    // 4. exact valid example remains exportable/valid.
    it("4: still accepts an example with exactly the ten allowed keys and nothing else", () => {
      expect(collectAiTrainingExampleErrors(VALID_EXAMPLE)).toEqual([]);
      expect(Object.keys(VALID_EXAMPLE).sort()).toEqual(
        ["confidence", "createdAt", "exampleId", "expectedOutput", "input", "language", "learningTask", "privacyStatus", "schemaVersion", "source"].sort(),
      );
    });
  });
});

// ARCHITECTURAL REVIEW CORRECTION (round 3): isExportableForTraining now
// enforces THREE independent gates -- structural validity, privacy, and
// quality/truth (minimum confidence per source) -- see the function's own
// header comment in aiLearningTrainingExample.ts for the full contract.
// "synthetic" bypasses the real-user PRIVACY review (no real user data
// was ever involved), but it does NOT bypass the QUALITY/TRUTH gate: a
// model/teacher-generated 'candidate' label is never training-exportable,
// regardless of source.
describe("isExportableForTraining", () => {
  describe("quality/truth gate: candidate confidence is never exportable, for any source", () => {
    // A. synthetic + candidate + unreviewed -> NOT exportable.
    it("A: synthetic + candidate + unreviewed -> NOT exportable", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "synthetic", confidence: "candidate", privacyStatus: "unreviewed" })).toBe(false);
    });

    // B. synthetic + validated + unreviewed -> exportable (privacy gate
    // skipped entirely for synthetic; quality gate satisfied).
    it("B: synthetic + validated + unreviewed -> exportable", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "synthetic", confidence: "validated", privacyStatus: "unreviewed" })).toBe(true);
    });

    // C. real_user + candidate + sanitized -> NOT exportable (privacy ok,
    // quality gate fails).
    it("C: real_user + candidate + sanitized -> NOT exportable", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "real_user", confidence: "candidate", privacyStatus: "sanitized" })).toBe(false);
    });

    // D. real_user + validated + sanitized -> exportable.
    it("D: real_user + validated + sanitized -> exportable", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "real_user", confidence: "validated", privacyStatus: "sanitized" })).toBe(true);
    });

    // E. corrected + validated + sanitized -> NOT exportable (validated
    // is below corrected's user_confirmed minimum).
    it("E: corrected + validated + sanitized -> NOT exportable", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "corrected", confidence: "validated", privacyStatus: "sanitized" })).toBe(false);
    });

    // F. corrected + user_confirmed + sanitized -> exportable.
    it("F: corrected + user_confirmed + sanitized -> exportable", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "corrected", confidence: "user_confirmed", privacyStatus: "sanitized" })).toBe(true);
    });

    // G. execution_verified + user_confirmed + cleared_for_export -> NOT
    // exportable (execution_verified source requires execution_verified
    // confidence specifically, not merely "high").
    it("G: execution_verified + user_confirmed + cleared_for_export -> NOT exportable", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "execution_verified", confidence: "user_confirmed", privacyStatus: "cleared_for_export" })).toBe(false);
    });

    // H. execution_verified + execution_verified + cleared_for_export ->
    // exportable.
    it("H: execution_verified + execution_verified + cleared_for_export -> exportable", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "execution_verified", confidence: "execution_verified", privacyStatus: "cleared_for_export" })).toBe(true);
    });
  });

  describe("privacy gate: unreviewed real-user-derived examples are refused regardless of confidence", () => {
    it("real_user/corrected/execution_verified examples are NOT exportable while unreviewed, even with maximal confidence", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "real_user", confidence: "validated", privacyStatus: "unreviewed" })).toBe(false);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "corrected", confidence: "user_confirmed", privacyStatus: "unreviewed" })).toBe(false);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "execution_verified", confidence: "execution_verified", privacyStatus: "unreviewed" })).toBe(false);
    });

    it("real_user/corrected/execution_verified examples become exportable once BOTH privacy and confidence requirements are met", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "real_user", confidence: "validated", privacyStatus: "sanitized" })).toBe(true);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "real_user", confidence: "validated", privacyStatus: "cleared_for_export" })).toBe(true);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "corrected", confidence: "user_confirmed", privacyStatus: "sanitized" })).toBe(true);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "corrected", confidence: "user_confirmed", privacyStatus: "cleared_for_export" })).toBe(true);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "execution_verified", confidence: "execution_verified", privacyStatus: "sanitized" })).toBe(true);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "execution_verified", confidence: "execution_verified", privacyStatus: "cleared_for_export" })).toBe(true);
    });

    it("privacy being satisfied does not bypass the quality gate -- corrected+sanitized still needs at least user_confirmed", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "corrected", confidence: "candidate", privacyStatus: "cleared_for_export" })).toBe(false);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "corrected", confidence: "validated", privacyStatus: "cleared_for_export" })).toBe(false);
    });
  });

  // I. example.language='de', expectedOutput.language='fa' -> invalid
  // example, therefore NOT exportable (structural validity gate catches
  // this before privacy/quality are ever considered).
  it("I: an example with mismatched language/expectedOutput.language is NOT exportable, even with maximal privacy and confidence", () => {
    const mismatched = {
      ...VALID_EXAMPLE,
      source: "synthetic" as const,
      confidence: "validated" as const,
      privacyStatus: "cleared_for_export" as const,
      language: "de" as const,
      expectedOutput: { ...VALID_EXAMPLE.expectedOutput, language: "fa" as const },
    };
    expect(isValidAiTrainingExample(mismatched)).toBe(false);
    expect(isExportableForTraining(mismatched)).toBe(false);
  });

  // J. malformed runtime object -> NOT exportable, never throws.
  describe("J: a malformed runtime object is never exportable, even if TypeScript typing was bypassed", () => {
    it("rejects null, a string, an array, and an empty object", () => {
      expect(isExportableForTraining(null)).toBe(false);
      expect(isExportableForTraining("not an example")).toBe(false);
      expect(isExportableForTraining([])).toBe(false);
      expect(isExportableForTraining({})).toBe(false);
    });

    it("rejects an object missing required fields even though it superficially resembles an example", () => {
      const { createdAt: _omit, ...missingCreatedAt } = VALID_EXAMPLE;
      expect(isExportableForTraining(missingCreatedAt)).toBe(false);
    });

    it("rejects an object with a bogus confidence/source/privacyStatus value", () => {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, confidence: "super-duper-sure" })).toBe(false);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "made_up_source" })).toBe(false);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, privacyStatus: "trust_me" })).toBe(false);
    });

    it("never throws for any of the above", () => {
      expect(() => isExportableForTraining(null)).not.toThrow();
      expect(() => isExportableForTraining(undefined)).not.toThrow();
      expect(() => isExportableForTraining(42)).not.toThrow();
    });
  });

  // ARCHITECTURAL REVIEW CORRECTION (round 4), isExportableForTraining
  // consequence of the closed-schema correction above: since
  // isExportableForTraining calls collectAiTrainingExampleErrors first
  // (via isValidAiTrainingExample), an otherwise-valid, otherwise
  // maximally-exportable example carrying an unrecognized extra field is
  // NOT exportable either.
  describe("closed-schema violations are never exportable, even with maximal privacy/confidence", () => {
    const maximallyExportable = { ...VALID_EXAMPLE, source: "synthetic" as const, confidence: "validated" as const, privacyStatus: "cleared_for_export" as const };

    // 3 (first half): access_token extra field -> not exportable.
    it("3a: an otherwise-valid example carrying access_token is NOT exportable", () => {
      expect(isExportableForTraining({ ...maximallyExportable, access_token: "leaked-value" })).toBe(false);
    });

    // 3 (second half): rawMetadata extra field -> not exportable.
    it("3b: an otherwise-valid example carrying rawMetadata is NOT exportable", () => {
      expect(isExportableForTraining({ ...maximallyExportable, rawMetadata: { anything: "goes here" } })).toBe(false);
    });

    it("4: the exact valid example (no extra fields) remains exportable", () => {
      expect(isExportableForTraining(maximallyExportable)).toBe(true);
    });
  });

  it("narrows its argument to AiTrainingExampleV1 on true (usable as a type guard)", () => {
    const value: unknown = VALID_EXAMPLE;
    if (isExportableForTraining(value)) {
      // Compiles only if `value` is narrowed to AiTrainingExampleV1 here.
      expect(value.exampleId).toBe("ex-1");
    } else {
      throw new Error("expected VALID_EXAMPLE to be exportable");
    }
  });
});
