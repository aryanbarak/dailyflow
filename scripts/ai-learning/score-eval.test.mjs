import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ALLOWED_PAYLOAD_KEYS, isValidRoutingPayload, parseJsonl, scoreEval } from "./score-eval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function expected(overrides = {}) {
  return {
    schemaVersion: "intent-routing-v1",
    language: "en",
    interactionClass: "write",
    domain: "calendar",
    intentType: "create_calendar_event",
    toolId: "calendar.create_event",
    requiresClarification: false,
    requiresApproval: true,
    ...overrides,
  };
}

function goldCase(caseId, language, expectedOverrides = {}) {
  return { caseId, category: "test", language, utterance: "irrelevant", expected: expected({ language, ...expectedOverrides }) };
}

describe("parseJsonl", () => {
  it("parses one JSON object per non-empty line, skipping blank lines", () => {
    const text = '{"a":1}\n\n{"a":2}\n';
    assert.deepEqual(parseJsonl(text), [{ a: 1 }, { a: 2 }]);
  });
});

describe("isValidRoutingPayload", () => {
  it("accepts a fully valid payload", () => {
    assert.equal(isValidRoutingPayload(expected()), true);
  });

  it("accepts a payload with intentType/toolId omitted", () => {
    const { intentType, toolId, ...rest } = expected();
    assert.equal(isValidRoutingPayload(rest), true);
  });

  it("rejects a non-object, a wrong schemaVersion, and an unknown enum value", () => {
    assert.equal(isValidRoutingPayload(null), false);
    assert.equal(isValidRoutingPayload("not an object"), false);
    assert.equal(isValidRoutingPayload({ ...expected(), schemaVersion: "v2" }), false);
    assert.equal(isValidRoutingPayload({ ...expected(), domain: "bogus" }), false);
    assert.equal(isValidRoutingPayload({ ...expected(), interactionClass: "bogus" }), false);
    assert.equal(isValidRoutingPayload({ ...expected(), language: "fr" }), false);
  });

  it("rejects non-boolean requiresClarification/requiresApproval", () => {
    assert.equal(isValidRoutingPayload({ ...expected(), requiresClarification: "no" }), false);
    assert.equal(isValidRoutingPayload({ ...expected(), requiresApproval: 1 }), false);
  });

  // ARCHITECTURAL REVIEW CORRECTION (round 2): the scorer's definition of
  // a valid payload must not be weaker than shared/aiLearning.ts's closed
  // IntentRoutingLearningPayloadV1 contract -- the benchmark must never
  // call something "valid" that the canonical shared contract rejects.
  describe("closed-contract parity with shared/aiLearning.ts", () => {
    // A. unknown field -> invalidPredictionCount +1 (proven at the
    // isValidRoutingPayload level here; the scoreEval-level assertion is
    // below).
    it("A: rejects a payload carrying an unrecognized field", () => {
      assert.equal(isValidRoutingPayload({ ...expected(), debugTrace: "anything" }), false);
    });

    // B. rawText field -> invalid.
    it("B: rejects a payload carrying rawText", () => {
      assert.equal(isValidRoutingPayload({ ...expected(), rawText: "the user's actual message" }), false);
    });

    // C. intentType="" -> invalid.
    it('C: rejects an empty-string intentType', () => {
      assert.equal(isValidRoutingPayload({ ...expected(), intentType: "" }), false);
    });

    // D. toolId="" -> invalid.
    it('D: rejects an empty-string toolId', () => {
      assert.equal(isValidRoutingPayload({ ...expected(), toolId: "" }), false);
    });

    it("still accepts a payload with exactly the eight allowed keys and nothing else", () => {
      assert.equal(isValidRoutingPayload(expected()), true);
      const { intentType, toolId, ...withoutOptionalFields } = expected();
      assert.equal(isValidRoutingPayload(withoutOptionalFields), true);
    });
  });
});

describe("scoreEval", () => {
  it("scores a perfect prediction set as 100% across every metric", () => {
    const gold = [goldCase("c1", "en"), goldCase("c2", "de", { language: "de" })];
    const predictions = [
      { caseId: "c1", predicted: expected({ language: "en" }) },
      { caseId: "c2", predicted: expected({ language: "de" }) },
    ];

    const metrics = scoreEval(gold, predictions);

    assert.equal(metrics.totalCases, 2);
    assert.equal(metrics.invalidPredictionCount, 0);
    assert.equal(metrics.intentAccuracy, 1);
    assert.equal(metrics.domainAccuracy, 1);
    assert.equal(metrics.toolAccuracy, 1);
    assert.equal(metrics.clarificationAccuracy, 1);
    assert.equal(metrics.approvalAccuracy, 1);
    assert.equal(metrics.languageAccuracy, 1);
    assert.equal(metrics.exactMatchAccuracy, 1);
    assert.equal(metrics.perLanguageAccuracy.en, 1);
    assert.equal(metrics.perLanguageAccuracy.de, 1);
  });

  it("counts a missing prediction as invalid, never as a match", () => {
    const gold = [goldCase("c1", "en")];
    const metrics = scoreEval(gold, []);

    assert.equal(metrics.invalidPredictionCount, 1);
    assert.equal(metrics.exactMatchAccuracy, 0);
    assert.equal(metrics.domainAccuracy, 0);
  });

  // ARCHITECTURAL REVIEW CORRECTION (round 2), end-to-end through
  // scoreEval itself (not just isValidRoutingPayload in isolation).
  describe("closed-contract violations count as invalid predictions end-to-end", () => {
    it("A: an unrecognized field in a prediction increments invalidPredictionCount", () => {
      const gold = [goldCase("c1", "en")];
      const predictions = [{ caseId: "c1", predicted: { ...expected({ language: "en" }), debugTrace: "anything" } }];

      const metrics = scoreEval(gold, predictions);

      assert.equal(metrics.invalidPredictionCount, 1);
      assert.equal(metrics.exactMatchAccuracy, 0);
    });

    it("B: a rawText field in a prediction increments invalidPredictionCount", () => {
      const gold = [goldCase("c1", "en")];
      const predictions = [{ caseId: "c1", predicted: { ...expected({ language: "en" }), rawText: "the user's actual message" } }];

      const metrics = scoreEval(gold, predictions);

      assert.equal(metrics.invalidPredictionCount, 1);
    });

    it('C: an empty-string intentType increments invalidPredictionCount', () => {
      const gold = [goldCase("c1", "en")];
      const predictions = [{ caseId: "c1", predicted: expected({ language: "en", intentType: "" }) }];

      const metrics = scoreEval(gold, predictions);

      assert.equal(metrics.invalidPredictionCount, 1);
    });

    it('D: an empty-string toolId increments invalidPredictionCount', () => {
      const gold = [goldCase("c1", "en")];
      const predictions = [{ caseId: "c1", predicted: expected({ language: "en", toolId: "" }) }];

      const metrics = scoreEval(gold, predictions);

      assert.equal(metrics.invalidPredictionCount, 1);
    });
  });

  // E. perfect valid prediction remains 100% -- see "scores a perfect
  // prediction set as 100% across every metric" above, and "a perfect
  // prediction set (language included) still scores 100% on every
  // metric, including languageAccuracy" below.

  // F. wrong language remains non-exact and lowers languageAccuracy --
  // see "a prediction with every routing field correct but the wrong
  // language is NOT an exact match" below.

  it("counts a structurally invalid prediction as invalid, never as a match", () => {
    const gold = [goldCase("c1", "en")];
    const predictions = [{ caseId: "c1", predicted: { schemaVersion: "intent-routing-v1", domain: "calendar" } }];

    const metrics = scoreEval(gold, predictions);

    assert.equal(metrics.invalidPredictionCount, 1);
    assert.equal(metrics.exactMatchAccuracy, 0);
  });

  it("scores per-field accuracy independently -- a wrong domain does not zero out a correct approval flag", () => {
    const gold = [goldCase("c1", "en")];
    const predictions = [
      { caseId: "c1", predicted: expected({ domain: "tasks" }) }, // wrong domain, everything else matches
    ];

    const metrics = scoreEval(gold, predictions);

    assert.equal(metrics.domainAccuracy, 0);
    assert.equal(metrics.approvalAccuracy, 1);
    assert.equal(metrics.clarificationAccuracy, 1);
    // exact match requires ALL fields, including domain, to match.
    assert.equal(metrics.exactMatchAccuracy, 0);
  });

  it("treats intentType/toolId both-omitted as a match (conversation/ambiguous cases)", () => {
    const gold = [goldCase("c1", "en", { interactionClass: "conversation", domain: "none", intentType: undefined, toolId: undefined, requiresApproval: false })];
    const predicted = { schemaVersion: "intent-routing-v1", language: "en", interactionClass: "conversation", domain: "none", requiresClarification: false, requiresApproval: false };

    const metrics = scoreEval(gold, [{ caseId: "c1", predicted }]);

    assert.equal(metrics.intentAccuracy, 1);
    assert.equal(metrics.toolAccuracy, 1);
    assert.equal(metrics.exactMatchAccuracy, 1);
  });

  it("computes per-language accuracy independently across languages", () => {
    const gold = [
      goldCase("en-1", "en"),
      goldCase("en-2", "en"),
      goldCase("de-1", "de", { language: "de" }),
    ];
    const predictions = [
      { caseId: "en-1", predicted: expected({ language: "en" }) },
      { caseId: "en-2", predicted: expected({ language: "en", domain: "tasks" }) }, // wrong
      { caseId: "de-1", predicted: expected({ language: "de" }) },
    ];

    const metrics = scoreEval(gold, predictions);

    assert.equal(metrics.perLanguageAccuracy.en, 0.5);
    assert.equal(metrics.perLanguageAccuracy.de, 1);
  });

  // ARCHITECTURAL REVIEW CORRECTION regression tests: `language` was
  // missing from isExactMatch -- a model predicting language=en for a
  // FA/DE case could previously still register as an exact match on
  // every other field.
  it("a prediction with every routing field correct but the wrong language is NOT an exact match", () => {
    const gold = [goldCase("fa-1", "fa", { language: "fa" })];
    // Every field matches the gold case's `expected` EXCEPT language.
    const predicted = expected({ language: "en" });

    const metrics = scoreEval(gold, [{ caseId: "fa-1", predicted }]);

    assert.equal(metrics.exactMatchAccuracy, 0);
    assert.equal(metrics.languageAccuracy, 0);
    // The gold case's own language bucket (fa) must not count this as an
    // exact match, even though domain/interactionClass/intentType/toolId/
    // requiresClarification/requiresApproval are all correct.
    assert.equal(metrics.perLanguageAccuracy.fa, 0);
    // Every non-language field still independently reports correct.
    assert.equal(metrics.domainAccuracy, 1);
    assert.equal(metrics.intentAccuracy, 1);
    assert.equal(metrics.toolAccuracy, 1);
    assert.equal(metrics.clarificationAccuracy, 1);
    assert.equal(metrics.approvalAccuracy, 1);
  });

  it("a perfect prediction set (language included) still scores 100% on every metric, including languageAccuracy", () => {
    const gold = [goldCase("en-1", "en"), goldCase("de-1", "de", { language: "de" }), goldCase("fa-1", "fa", { language: "fa" })];
    const predictions = gold.map((c) => ({ caseId: c.caseId, predicted: c.expected }));

    const metrics = scoreEval(gold, predictions);

    assert.equal(metrics.exactMatchAccuracy, 1);
    assert.equal(metrics.languageAccuracy, 1);
    assert.equal(metrics.domainAccuracy, 1);
    assert.equal(metrics.intentAccuracy, 1);
    assert.equal(metrics.toolAccuracy, 1);
    assert.equal(metrics.clarificationAccuracy, 1);
    assert.equal(metrics.approvalAccuracy, 1);
    assert.equal(metrics.perLanguageAccuracy.en, 1);
    assert.equal(metrics.perLanguageAccuracy.de, 1);
    assert.equal(metrics.perLanguageAccuracy.fa, 1);
  });
});

// ARCHITECTURAL REVIEW CORRECTION (round 2): guards ALLOWED_PAYLOAD_KEYS
// above against silently drifting out of sync with
// shared/aiLearning.ts's own IntentRoutingLearningPayloadV1 allowlist.
// Reads that .ts file as plain TEXT (no TS loader/build dependency,
// matching this repo's own supabase/tests/*.migration_structure.test.ts
// convention of asserting structure against source text) and extracts
// every `readonly <fieldName>` declared inside the interface body.
describe("ALLOWED_PAYLOAD_KEYS parity with shared/aiLearning.ts's IntentRoutingLearningPayloadV1", () => {
  function extractIntentRoutingLearningPayloadV1Keys() {
    const sharedSourcePath = path.join(__dirname, "..", "..", "shared", "aiLearning.ts");
    const source = readFileSync(sharedSourcePath, "utf8");
    const interfaceMatch = source.match(/export interface IntentRoutingLearningPayloadV1 \{([\s\S]*?)\n\}/);
    assert.ok(interfaceMatch, "could not locate IntentRoutingLearningPayloadV1's interface body in shared/aiLearning.ts -- has it been renamed or restructured?");
    const body = interfaceMatch[1];
    const keys = [...body.matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]);
    assert.ok(keys.length > 0, "extracted zero fields from IntentRoutingLearningPayloadV1 -- the extraction regex likely no longer matches the interface's current shape");
    return new Set(keys);
  }

  it("ALLOWED_PAYLOAD_KEYS contains exactly the same 8 keys as shared/aiLearning.ts's IntentRoutingLearningPayloadV1, no more and no fewer", () => {
    const sharedKeys = extractIntentRoutingLearningPayloadV1Keys();
    const scorerKeys = ALLOWED_PAYLOAD_KEYS;

    const missingFromScorer = [...sharedKeys].filter((k) => !scorerKeys.has(k));
    const extraInScorer = [...scorerKeys].filter((k) => !sharedKeys.has(k));

    assert.deepEqual(missingFromScorer, [], `shared/aiLearning.ts declared field(s) missing from the scorer's ALLOWED_PAYLOAD_KEYS: ${missingFromScorer.join(", ")}`);
    assert.deepEqual(extraInScorer, [], `scorer's ALLOWED_PAYLOAD_KEYS has field(s) shared/aiLearning.ts does not declare: ${extraInScorer.join(", ")}`);
  });
});
