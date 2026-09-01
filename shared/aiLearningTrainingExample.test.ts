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
});

describe("isExportableForTraining (the one privacy gate ALF-0 builds)", () => {
  it("synthetic examples are always exportable, regardless of privacyStatus", () => {
    expect(isExportableForTraining({ ...VALID_EXAMPLE, source: "synthetic", privacyStatus: "unreviewed" })).toBe(true);
  });

  it("real_user/corrected/execution_verified examples are NOT exportable while unreviewed", () => {
    for (const source of ["real_user", "corrected", "execution_verified"] as const) {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source, privacyStatus: "unreviewed" })).toBe(false);
    }
  });

  it("real_user/corrected/execution_verified examples become exportable once sanitized or cleared_for_export", () => {
    for (const source of ["real_user", "corrected", "execution_verified"] as const) {
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source, privacyStatus: "sanitized" })).toBe(true);
      expect(isExportableForTraining({ ...VALID_EXAMPLE, source, privacyStatus: "cleared_for_export" })).toBe(true);
    }
  });
});
