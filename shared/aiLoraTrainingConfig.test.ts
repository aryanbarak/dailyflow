import { describe, expect, it } from "vitest";
import { collectLoraTrainingConfigErrors, isValidLoraTrainingConfig, type LoraTrainingConfig } from "./aiLoraTrainingConfig";

const VALID_CONFIG: LoraTrainingConfig = {
  baseModelId: "example-base-model-7b",
  baseModelRevision: "sha256:0000000000000000000000000000000000000000000000000000000000000",
  tokenizerId: "example-base-model-7b",
  chatTemplateId: "example-chat-template-v1",
  trainingDatasetVersion: "intent-routing-v1-training-2026-09-01",
  loraRank: 16,
  loraAlpha: 32,
  targetModules: ["q_proj", "v_proj"],
  learningRate: 0.0002,
  epochs: 3,
  seed: 42,
  maxSequenceLength: 2048,
  evalSuiteVersion: "intent-routing-v1",
};

describe("LoraTrainingConfig validation", () => {
  it("accepts a fully valid config", () => {
    expect(isValidLoraTrainingConfig(VALID_CONFIG)).toBe(true);
    expect(collectLoraTrainingConfigErrors(VALID_CONFIG)).toEqual([]);
  });

  it("requires every field the ADR-0020 checklist names", () => {
    for (const field of Object.keys(VALID_CONFIG) as (keyof LoraTrainingConfig)[]) {
      const { [field]: _omit, ...rest } = VALID_CONFIG;
      expect(collectLoraTrainingConfigErrors(rest).length, `expected an error when ${field} is missing`).toBeGreaterThan(0);
    }
  });

  it("rejects a non-positive loraRank/loraAlpha/learningRate/epochs/maxSequenceLength", () => {
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, loraRank: 0 }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, loraRank: -1 }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, loraAlpha: 0 }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, learningRate: 0 }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, epochs: 0 }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, maxSequenceLength: 0 }).length).toBeGreaterThan(0);
  });

  it("rejects a non-integer loraRank/epochs/seed/maxSequenceLength", () => {
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, loraRank: 1.5 }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, epochs: 2.5 }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, seed: 1.5 }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, maxSequenceLength: 100.5 }).length).toBeGreaterThan(0);
  });

  it("rejects an empty or non-string-array targetModules", () => {
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, targetModules: [] }).length).toBeGreaterThan(0);
    expect(collectLoraTrainingConfigErrors({ ...VALID_CONFIG, targetModules: [1, 2] }).length).toBeGreaterThan(0);
  });

  it("allows seed to be zero or negative (a valid RNG seed, unlike the positive-only numeric fields)", () => {
    expect(isValidLoraTrainingConfig({ ...VALID_CONFIG, seed: 0 })).toBe(true);
    expect(isValidLoraTrainingConfig({ ...VALID_CONFIG, seed: -7 })).toBe(true);
  });
});
