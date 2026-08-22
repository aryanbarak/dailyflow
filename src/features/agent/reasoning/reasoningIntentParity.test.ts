import { describe, expect, it } from "vitest";
import { supportedIntentTypes as validatorIntentTypes } from "./intentValidator";
// Cross-package import on purpose: the Worker and the frontend are two
// separately deployed artifacts (Cloudflare Worker vs Pages), so nothing
// enforces that their intent lists agree except this test. A missing entry
// on either side fails silently otherwise — Gemini simply can't propose an
// intent absent from the Worker's schema enum, or the deterministic
// validator rejects a proposal absent from its own supported-type list —
// with no error, just a quiet fallback to ask_clarification/unsupported.
import { SUPPORTED_INTENT_VALUES as workerIntentValues } from "../../../../agent/worker/reasoning-endpoint";
import { writeIntentRegistry } from "../../../../shared/writeIntentRegistry";

// Task 45c PART B (Ruling 2, PO): a registry entry with `exposure: 'ui-only'`
// is a DELIBERATE, documented exception to this file's own parity
// invariant -- it must still appear in intentValidator.ts's
// supportedIntentTypes (so validateAgentIntentProposal recognizes and
// explicitly rejects it, see that function's own import_bank_statement
// guard) while being absent from the Worker's SUPPORTED_INTENT_VALUES
// schema enum (so the model can never be told the intent exists at all,
// let alone propose it). Derived from the registry, not hand-listed, so a
// future ui-only entry is automatically exempted here too.
const UI_ONLY_INTENT_TYPES = new Set<string>(
  writeIntentRegistry.filter((entry) => entry.exposure === "ui-only").map((entry) => entry.intentType),
);

describe("reasoning intent parity between the Worker schema and the frontend validator", () => {
  it("keeps every CHAT-exposed intent in sync across both lists", () => {
    // Guards against a vacuous pass if either import silently resolved empty.
    expect(workerIntentValues.length).toBeGreaterThan(0);
    expect(validatorIntentTypes.length).toBeGreaterThan(0);

    const workerSet = new Set<string>(workerIntentValues);
    const validatorSet = new Set<string>(validatorIntentTypes);

    const missingFromWorker = validatorIntentTypes.filter(
      (type) => !workerSet.has(type) && !UI_ONLY_INTENT_TYPES.has(type),
    );
    const missingFromValidator = workerIntentValues.filter((type) => !validatorSet.has(type));

    expect(
      missingFromWorker,
      "These intents are in intentValidator.ts's supportedIntentTypes but missing from " +
        "agent/worker/reasoning-endpoint.ts's SUPPORTED_INTENT_VALUES — Gemini's schema enum " +
        "cannot include them until they're added there, so the model can never propose them. " +
        "(A ui-only registry entry is EXPECTED to be missing here and is already excluded from " +
        "this check — see UI_ONLY_INTENT_TYPES above.)",
    ).toEqual([]);

    expect(
      missingFromValidator,
      "These intents are in agent/worker/reasoning-endpoint.ts's SUPPORTED_INTENT_VALUES but " +
        "missing from intentValidator.ts's supportedIntentTypes — the deterministic validator " +
        "will reject any proposal for them as unsupported until they're added there.",
    ).toEqual([]);
  });

  // Task 45c PART B (Ruling 2, PO): the exception itself, proven directly
  // rather than just carved out of the loop above -- a ui-only entry must
  // be on EXACTLY ONE side of the parity split, never both and never
  // neither.
  it.each([...UI_ONLY_INTENT_TYPES])(
    "ui-only intent %s: known to the validator (so it can be explicitly rejected) but absent from the Worker's schema enum (so the model can never output it)",
    (intentType) => {
      expect(validatorIntentTypes).toContain(intentType);
      expect(workerIntentValues).not.toContain(intentType);
    },
  );

  it("asserts at least one ui-only intent exists, so the exception above is not vacuous", () => {
    expect(UI_ONLY_INTENT_TYPES.size).toBeGreaterThan(0);
  });
});
