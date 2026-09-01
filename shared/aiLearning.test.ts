import { describe, expect, it } from "vitest";
import {
  AI_LEARNING_DOMAINS,
  AI_LEARNING_EVENT_KINDS,
  AI_LEARNING_INTERACTION_CLASSES,
  AI_LEARNING_LABEL_CONFIDENCES,
  AI_LEARNING_PRODUCER_TYPES,
  AI_LEARNING_TASKS,
  collectAiLearningEventInputErrors,
  collectAiModelManifestErrors,
  collectIntentRoutingLearningPayloadErrors,
  isAiLearningEventKind,
  isAiLearningLabelConfidence,
  isAiLearningProducerType,
  isAiLearningTask,
  isIntentRoutingLearningPayloadV1,
  isValidAiLearningEventInput,
  isValidAiModelManifest,
  type AiLearningEventInput,
  type AiModelManifest,
  type IntentRoutingLearningPayloadV1,
} from "./aiLearning";

const VALID_PAYLOAD: IntentRoutingLearningPayloadV1 = {
  schemaVersion: "intent-routing-v1",
  language: "fa",
  interactionClass: "write",
  domain: "calendar",
  intentType: "create_calendar_event",
  toolId: "calendar.create_event",
  requiresClarification: false,
  requiresApproval: true,
};

const VALID_EVENT_INPUT: AiLearningEventInput = {
  userId: "user-1",
  correlationId: "corr-1",
  idempotencyKey: "idem-1",
  learningTask: "intent_routing_v1",
  schemaVersion: "intent-routing-v1",
  eventKind: "turn_observed",
  producerType: "deterministic_policy",
  payload: { ...VALID_PAYLOAD },
};

const VALID_MANIFEST: AiModelManifest = {
  providerId: "workers-ai",
  baseModelId: "UNDECIDED",
  evalSuiteVersion: "intent-routing-v1",
  promptContractVersion: "1",
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("AiLearningTask registry", () => {
  it("contains exactly the ALF-0 task", () => {
    expect(AI_LEARNING_TASKS).toEqual(["intent_routing_v1"]);
  });

  it("isAiLearningTask accepts registered tasks and rejects everything else", () => {
    expect(isAiLearningTask("intent_routing_v1")).toBe(true);
    expect(isAiLearningTask("intent_routing_v2")).toBe(false);
    expect(isAiLearningTask("")).toBe(false);
    expect(isAiLearningTask(undefined)).toBe(false);
  });
});

describe("AiLearningEventKind / AiLearningProducerType / AiLearningLabelConfidence enums", () => {
  it("fixes the five-step append-only event kind vocabulary", () => {
    expect(AI_LEARNING_EVENT_KINDS).toEqual([
      "turn_observed",
      "production_label",
      "shadow_prediction",
      "user_feedback",
      "execution_outcome",
    ]);
    expect(isAiLearningEventKind("turn_observed")).toBe(true);
    expect(isAiLearningEventKind("bogus_kind")).toBe(false);
  });

  it("fixes the four producer types", () => {
    expect(AI_LEARNING_PRODUCER_TYPES).toEqual([
      "deterministic_policy",
      "shadow_model",
      "user",
      "execution_verifier",
    ]);
    expect(isAiLearningProducerType("shadow_model")).toBe(true);
    expect(isAiLearningProducerType("gemini")).toBe(false);
  });

  it("fixes the four label-confidence tiers, weakest to strongest", () => {
    expect(AI_LEARNING_LABEL_CONFIDENCES).toEqual([
      "candidate",
      "validated",
      "user_confirmed",
      "execution_verified",
    ]);
    expect(isAiLearningLabelConfidence("candidate")).toBe(true);
    expect(isAiLearningLabelConfidence("gold")).toBe(false);
  });
});

describe("IntentRoutingLearningPayloadV1 validation", () => {
  it("accepts a fully valid payload", () => {
    expect(isIntentRoutingLearningPayloadV1(VALID_PAYLOAD)).toBe(true);
    expect(collectIntentRoutingLearningPayloadErrors(VALID_PAYLOAD)).toEqual([]);
  });

  it("accepts a payload with intentType/toolId omitted (read/conversation turns)", () => {
    const payload = {
      schemaVersion: "intent-routing-v1",
      language: "en",
      interactionClass: "conversation",
      domain: "none",
      requiresClarification: false,
      requiresApproval: false,
    };
    expect(isIntentRoutingLearningPayloadV1(payload)).toBe(true);
  });

  it("rejects a non-object payload", () => {
    expect(isIntentRoutingLearningPayloadV1(null)).toBe(false);
    expect(isIntentRoutingLearningPayloadV1("not an object")).toBe(false);
    expect(isIntentRoutingLearningPayloadV1(["array"])).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    const errors = collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, schemaVersion: "intent-routing-v2" });
    expect(errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects an invalid enum value for every enum field, one at a time", () => {
    expect(collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, language: "fr" }).length).toBeGreaterThan(0);
    expect(collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, interactionClass: "bogus" }).length).toBeGreaterThan(0);
    expect(collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, domain: "bogus" }).length).toBeGreaterThan(0);
  });

  it("rejects non-boolean requiresClarification/requiresApproval", () => {
    expect(collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, requiresClarification: "no" }).length).toBeGreaterThan(0);
    expect(collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, requiresApproval: 1 }).length).toBeGreaterThan(0);
  });

  it("rejects an empty-string intentType/toolId (must be a real non-empty string when present)", () => {
    expect(collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, intentType: "" }).length).toBeGreaterThan(0);
    expect(collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, toolId: "" }).length).toBeGreaterThan(0);
  });

  it("rejects a payload carrying identity or credential-shaped fields (ADR-0020: no secrets in model-facing payloads)", () => {
    for (const key of ["userId", "user_id", "token", "accessToken", "access_token", "password", "secret", "apiKey", "api_key"]) {
      const errors = collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, [key]: "leaked-value" });
      expect(errors.some((e) => e.includes(key)), `expected an error mentioning "${key}"`).toBe(true);
    }
  });
});

describe("AiLearningEventInput validation", () => {
  it("accepts a fully valid event input", () => {
    expect(isValidAiLearningEventInput(VALID_EVENT_INPUT)).toBe(true);
    expect(collectAiLearningEventInputErrors(VALID_EVENT_INPUT)).toEqual([]);
  });

  it("requires userId, correlationId, and idempotencyKey to be non-empty strings", () => {
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, userId: "" }).length).toBeGreaterThan(0);
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, correlationId: "" }).length).toBeGreaterThan(0);
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, idempotencyKey: "" }).length).toBeGreaterThan(0);
  });

  it("rejects an unknown learningTask/eventKind/producerType", () => {
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, learningTask: "bogus" }).length).toBeGreaterThan(0);
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, eventKind: "bogus" }).length).toBeGreaterThan(0);
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, producerType: "bogus" }).length).toBeGreaterThan(0);
  });

  it("accepts null for every nullable field", () => {
    const input = {
      ...VALID_EVENT_INPUT,
      sessionId: null,
      sourceMessageId: null,
      providerId: null,
      modelId: null,
      modelVersion: null,
      labelConfidence: null,
      sourceHash: null,
    };
    expect(isValidAiLearningEventInput(input)).toBe(true);
  });

  it("rejects an invalid labelConfidence even though the field itself is optional", () => {
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, labelConfidence: "gold" }).length).toBeGreaterThan(0);
  });

  it("requires payload to be a plain object", () => {
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, payload: "not an object" }).length).toBeGreaterThan(0);
    expect(collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, payload: null }).length).toBeGreaterThan(0);
  });
});

describe("AiModelManifest validation", () => {
  it("accepts a fully valid manifest", () => {
    expect(isValidAiModelManifest(VALID_MANIFEST)).toBe(true);
    expect(collectAiModelManifestErrors(VALID_MANIFEST)).toEqual([]);
  });

  it("requires providerId, baseModelId, evalSuiteVersion, promptContractVersion, createdAt", () => {
    for (const field of ["providerId", "baseModelId", "evalSuiteVersion", "promptContractVersion", "createdAt"] as const) {
      const { [field]: _omit, ...rest } = VALID_MANIFEST;
      expect(collectAiModelManifestErrors(rest).length, `expected an error when ${field} is missing`).toBeGreaterThan(0);
    }
  });

  it("rejects createdAt that is not a valid ISO timestamp", () => {
    expect(collectAiModelManifestErrors({ ...VALID_MANIFEST, createdAt: "not-a-date" }).length).toBeGreaterThan(0);
  });

  it("keeps a base model and an adapter version-separate: an adapter's base dependency must stay explicit", () => {
    // adapterId with no exactBaseRevision is invalid by construction --
    // an adapter's base dependency must never be implicit.
    const withAdapterNoRevision = { ...VALID_MANIFEST, adapterId: "lora-v0.1" };
    expect(collectAiModelManifestErrors(withAdapterNoRevision).length).toBeGreaterThan(0);

    // adapterId with exactBaseRevision set is valid -- base, adapter, and
    // training dataset are three independently versioned fields.
    const withAdapterAndRevision = {
      ...VALID_MANIFEST,
      exactBaseRevision: "rev-123",
      adapterId: "lora-v0.1",
      adapterVersion: "0.1.0",
      trainingDatasetVersion: "dataset-2026-09-01",
    };
    expect(isValidAiModelManifest(withAdapterAndRevision)).toBe(true);
  });
});
