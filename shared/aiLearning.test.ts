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

  // ARCHITECTURAL REVIEW CORRECTION: a blacklist of a few named
  // secret-shaped keys is insufficient on its own -- it says nothing
  // about a field that doesn't happen to look like a credential.
  // IntentRoutingLearningPayloadV1 is a CLOSED shape: exactly the eight
  // declared keys are allowed, so ANY unrecognized field is rejected,
  // credential-shaped or not.
  describe("closed-schema enforcement (no unknown top-level keys)", () => {
    it("rejects rawText, message, and content -- none of which are part of the contract", () => {
      for (const key of ["rawText", "message", "content"]) {
        const errors = collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, [key]: "the user's actual message text" });
        expect(errors.some((e) => e.includes(key)), `expected an error mentioning "${key}"`).toBe(true);
      }
    });

    it("rejects an arbitrary unrecognized field that looks like harmless metadata", () => {
      const errors = collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, debugTrace: { anything: "goes here" } });
      expect(errors.some((e) => e.includes("debugTrace"))).toBe(true);
    });

    it("rejects a nested arbitrary metadata object under an unrecognized key", () => {
      const errors = collectIntentRoutingLearningPayloadErrors({ ...VALID_PAYLOAD, metadata: { nested: { deeply: "irrelevant" } } });
      expect(errors.some((e) => e.includes("metadata"))).toBe(true);
    });

    it("still accepts a payload with exactly the eight allowed keys and nothing else", () => {
      expect(collectIntentRoutingLearningPayloadErrors(VALID_PAYLOAD)).toEqual([]);
      const withoutOptionalFields = {
        schemaVersion: "intent-routing-v1",
        language: "en",
        interactionClass: "conversation",
        domain: "none",
        requiresClarification: false,
        requiresApproval: false,
      };
      expect(collectIntentRoutingLearningPayloadErrors(withoutOptionalFields)).toEqual([]);
    });
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

  // ARCHITECTURAL REVIEW CORRECTION: for ALF-0's only (learningTask,
  // schemaVersion) combination, `payload` must pass the ACTUAL
  // IntentRoutingLearningPayloadV1 contract -- not merely "is a plain
  // object." Before this correction, a malformed/malicious payload with
  // raw text or a credential-shaped field could reach the ledger as long
  // as the rest of the envelope validated -- these tests prove that can
  // no longer happen BEFORE any network call is attempted (the caller,
  // agent/worker/ai-learning/learning-ledger.ts's appendAiLearningEvent,
  // runs this validation first and never calls supabasePost when it fails
  // -- see learning-ledger.test.ts's own "without making any network
  // call" test).
  describe("payload contract enforcement for learningTask=intent_routing_v1", () => {
    it("rejects a malformed domain inside payload", () => {
      const errors = collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, payload: { ...VALID_PAYLOAD, domain: "bogus" } });
      expect(errors.some((e) => e.startsWith("payload:") && e.includes("domain"))).toBe(true);
    });

    it("rejects a payload carrying rawText", () => {
      const errors = collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, payload: { ...VALID_PAYLOAD, rawText: "the user's actual message" } });
      expect(errors.some((e) => e.startsWith("payload:") && e.includes("rawText"))).toBe(true);
    });

    it("rejects a payload carrying access_token", () => {
      const errors = collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, payload: { ...VALID_PAYLOAD, access_token: "leaked" } });
      expect(errors.some((e) => e.startsWith("payload:") && e.includes("access_token"))).toBe(true);
    });

    it("rejects a payload carrying an arbitrary unknown field", () => {
      const errors = collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, payload: { ...VALID_PAYLOAD, someUnknownField: 123 } });
      expect(errors.some((e) => e.startsWith("payload:") && e.includes("someUnknownField"))).toBe(true);
    });

    it("a genuinely valid routing payload still validates with zero errors", () => {
      expect(collectAiLearningEventInputErrors(VALID_EVENT_INPUT)).toEqual([]);
    });
  });
});

describe("eventKind / producerType / labelConfidence semantics (ADR-0020: a model prediction is never truth)", () => {
  it("accepts exactly the five canonical ALF-0 combinations", () => {
    const validCombinations: Array<Pick<AiLearningEventInput, "eventKind" | "producerType" | "labelConfidence">> = [
      { eventKind: "turn_observed", producerType: "deterministic_policy", labelConfidence: null },
      { eventKind: "production_label", producerType: "deterministic_policy", labelConfidence: "validated" },
      { eventKind: "shadow_prediction", producerType: "shadow_model", labelConfidence: "candidate" },
      { eventKind: "user_feedback", producerType: "user", labelConfidence: "user_confirmed" },
      { eventKind: "execution_outcome", producerType: "execution_verifier", labelConfidence: "execution_verified" },
    ];
    for (const combination of validCombinations) {
      const input = {
        ...VALID_EVENT_INPUT,
        ...combination,
        providerId: "workers-ai",
        modelId: "some-model",
        modelVersion: "1",
      };
      expect(collectAiLearningEventInputErrors(input), JSON.stringify(combination)).toEqual([]);
    }
  });

  it("omitting labelConfidence for turn_observed is equivalent to explicit null", () => {
    const { labelConfidence: _omit, ...rest } = VALID_EVENT_INPUT;
    expect(collectAiLearningEventInputErrors(rest)).toEqual([]);
  });

  // The task's own explicit regression set: a shadow prediction can never
  // become training truth due only to malformed construction code.
  it.each([
    ["shadow_model", "validated"],
    ["shadow_model", "user_confirmed"],
    ["shadow_model", "execution_verified"],
  ] as const)("producerType=%s + labelConfidence=%s is rejected regardless of eventKind", (producerType, labelConfidence) => {
    for (const eventKind of AI_LEARNING_EVENT_KINDS) {
      const errors = collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, eventKind, producerType, labelConfidence, providerId: "p", modelId: "m", modelVersion: "1" });
      expect(errors.length, `eventKind=${eventKind} producerType=${producerType} labelConfidence=${labelConfidence}`).toBeGreaterThan(0);
    }
  });

  it("eventKind=production_label with labelConfidence=candidate is rejected", () => {
    const errors = collectAiLearningEventInputErrors({ ...VALID_EVENT_INPUT, eventKind: "production_label", producerType: "deterministic_policy", labelConfidence: "candidate" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("eventKind=execution_outcome with labelConfidence=candidate is rejected", () => {
    const errors = collectAiLearningEventInputErrors({
      ...VALID_EVENT_INPUT,
      eventKind: "execution_outcome",
      producerType: "execution_verifier",
      labelConfidence: "candidate",
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("eventKind=shadow_prediction requires non-empty providerId, modelId, and modelVersion", () => {
    const base = { ...VALID_EVENT_INPUT, eventKind: "shadow_prediction" as const, producerType: "shadow_model" as const, labelConfidence: "candidate" as const };

    expect(collectAiLearningEventInputErrors({ ...base, providerId: "gemini", modelId: "gemini-2.5-flash", modelVersion: "2025-09" })).toEqual([]);

    for (const missingField of ["providerId", "modelId", "modelVersion"] as const) {
      const errors = collectAiLearningEventInputErrors({ ...base, providerId: "gemini", modelId: "m", modelVersion: "1", [missingField]: null });
      expect(errors.some((e) => e.includes(missingField)), `expected an error mentioning ${missingField}`).toBe(true);
    }
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
