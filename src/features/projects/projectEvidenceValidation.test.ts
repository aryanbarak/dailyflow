import { describe, expect, it } from "vitest";
import { validateCreateProjectEvidenceInput } from "./projectEvidenceValidation";

const VALID_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_SUPERSEDES_ID = "22222222-2222-4222-8222-222222222222";

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: VALID_PROJECT_ID,
    sourceKind: "architecture_document",
    classification: "canonical_document_observation",
    title: "Project Domain",
    reference: "docs/architecture/project-domain.md",
    collectedAt: "2026-08-02T00:00:00.000Z",
    adapterIdentity: "repository-document-adapter",
    adapterVersion: "1.0.0",
    verificationMethod: "deterministic file read",
    ...overrides,
  };
}

function expectValid<T>(result: { valid: boolean }): asserts result is { valid: true; value: T } {
  expect(result.valid).toBe(true);
}

function expectInvalid(result: { valid: boolean }): asserts result is { valid: false; errors: unknown[] } {
  expect(result.valid).toBe(false);
}

describe("validateCreateProjectEvidenceInput", () => {
  it("accepts a minimal valid input and normalizes it", () => {
    const result = validateCreateProjectEvidenceInput(validInput());
    expectValid(result);
    expect(result.value).toEqual(validInput());
  });

  it("accepts a full valid input with every optional field", () => {
    const result = validateCreateProjectEvidenceInput(
      validInput({
        sourceRevision: "ae14be6",
        confidence: 0.9,
        uncertainty: "Not independently verified against a live checkout.",
        notes: "Collected during Slice 4B foundation work.",
        supersedesId: VALID_SUPERSEDES_ID,
        acquisitionAttemptId: "attempt-001",
      }),
    );
    expectValid(result);
    expect(result.value).toMatchObject({
      sourceRevision: "ae14be6",
      confidence: 0.9,
      supersedesId: VALID_SUPERSEDES_ID,
      acquisitionAttemptId: "attempt-001",
    });
  });

  it("accepts every currently supported classification", () => {
    for (const classification of [
      "observed",
      "explicit_user_statement",
      "imported",
      "verified_provider_observation",
      "canonical_document_observation",
    ]) {
      expectValid(validateCreateProjectEvidenceInput(validInput({ classification })));
    }
  });

  it("rejects an unsupported classification", () => {
    const result = validateCreateProjectEvidenceInput(validInput({ classification: "derived" }));
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_CLASSIFICATION" }));
  });

  it("rejects every explicitly forbidden classification category", () => {
    for (const classification of ["derived", "llm_inferred", "generated", "rejected", "accepted_execution_result"]) {
      const result = validateCreateProjectEvidenceInput(validInput({ classification }));
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_CLASSIFICATION" }));
    }
  });

  it("rejects an unsupported source kind", () => {
    const result = validateCreateProjectEvidenceInput(validInput({ sourceKind: "not_a_real_kind" }));
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_SOURCE_KIND" }));
  });

  it("rejects malformed or null input", () => {
    expectInvalid(validateCreateProjectEvidenceInput(null));
    expectInvalid(validateCreateProjectEvidenceInput(undefined));
    expectInvalid(validateCreateProjectEvidenceInput("a string"));
    expectInvalid(validateCreateProjectEvidenceInput(42));
    expectInvalid(validateCreateProjectEvidenceInput(["not", "an", "object"]));
  });

  it("rejects an unknown top-level field", () => {
    const result = validateCreateProjectEvidenceInput(validInput({ ownerId: "attacker" }));
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_FIELD" }));
  });

  it("rejects a prototype-pollution key at the top level", () => {
    const raw = JSON.parse(`{"__proto__":{"polluted":true},${JSON.stringify(validInput()).slice(1)}`);
    const result = validateCreateProjectEvidenceInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
  });

  it("rejects constructor/prototype as object keys", () => {
    for (const key of ["constructor", "prototype"]) {
      const raw: Record<string, unknown> = { ...validInput() };
      Object.defineProperty(raw, key, { value: {}, enumerable: true, configurable: true });
      const result = validateCreateProjectEvidenceInput(raw);
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
    }
  });

  it("rejects a throwing getter on a top-level field without invoking it more than once or crashing", () => {
    const raw: Record<string, unknown> = { ...validInput() };
    let readCount = 0;
    Object.defineProperty(raw, "title", {
      enumerable: true,
      get() {
        readCount += 1;
        throw new Error("hostile getter");
      },
    });
    expect(() => validateCreateProjectEvidenceInput(raw)).not.toThrow();
    const result = validateCreateProjectEvidenceInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
    expect(readCount).toBe(0);
  });

  it("rejects a plain getter (non-throwing accessor) on a top-level field", () => {
    const raw: Record<string, unknown> = { ...validInput() };
    Object.defineProperty(raw, "title", { enumerable: true, get: () => "Renamed via getter" });
    const result = validateCreateProjectEvidenceInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
  });

  it("rejects a cyclic reference", () => {
    const raw: Record<string, unknown> = { ...validInput() };
    const nested: Record<string, unknown> = { self: null };
    nested.self = nested;
    raw.notes = nested;
    const result = validateCreateProjectEvidenceInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
  });

  it("rejects a class instance value", () => {
    class Hostile {
      value = "x";
    }
    const raw = { ...validInput(), notes: new Hostile() };
    const result = validateCreateProjectEvidenceInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
  });

  it("rejects functions, symbols, and bigint", () => {
    for (const value of [() => {}, Symbol("x"), BigInt(1)] as unknown[]) {
      const result = validateCreateProjectEvidenceInput({ ...validInput(), notes: value });
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
    }
  });

  it("rejects NaN and Infinity anywhere in the input", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = validateCreateProjectEvidenceInput(validInput({ confidence: value }));
      expectInvalid(result);
    }
  });

  it("rejects a missing title, reference, adapter identity, adapter version, or verification method", () => {
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ title: "" })));
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ reference: "" })));
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ adapterIdentity: "" })));
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ adapterVersion: "" })));
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ verificationMethod: "" })));
  });

  it("rejects an invalid collectedAt", () => {
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ collectedAt: "not-a-date" })));
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ collectedAt: "2026-08-02" })));
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ collectedAt: 12345 })));
  });

  describe("confidence bounds", () => {
    it("accepts confidence at the boundaries", () => {
      expectValid(validateCreateProjectEvidenceInput(validInput({ confidence: 0 })));
      expectValid(validateCreateProjectEvidenceInput(validInput({ confidence: 1 })));
    });

    it("rejects confidence outside [0, 1]", () => {
      const below = validateCreateProjectEvidenceInput(validInput({ confidence: -0.1 }));
      expectInvalid(below);
      expect(below.errors).toContainEqual(expect.objectContaining({ code: "INVALID_CONFIDENCE" }));

      const above = validateCreateProjectEvidenceInput(validInput({ confidence: 1.1 }));
      expectInvalid(above);
      expect(above.errors).toContainEqual(expect.objectContaining({ code: "INVALID_CONFIDENCE" }));
    });

    it("rejects a non-numeric confidence", () => {
      expectInvalid(validateCreateProjectEvidenceInput(validInput({ confidence: "0.9" })));
    });
  });

  describe("source reference safety", () => {
    it("rejects traversal, absolute paths, and unsafe characters for a document-like source kind", () => {
      const unsafeReferences = [
        "../../etc/passwd",
        "/etc/passwd",
        "C:\\Windows\\System32",
        "docs\\architecture\\project-domain.md",
        "docs/../../../secret.md",
        "docs/./architecture/project-domain.md",
        "docs/architecture/%2e%2e/secret.md",
        "docs/architecture/proj ect.md",
        `docs/architecture/project${String.fromCharCode(0)}.md`,
      ];
      for (const reference of unsafeReferences) {
        const result = validateCreateProjectEvidenceInput(validInput({ sourceKind: "architecture_document", reference }));
        expectInvalid(result);
        expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_REFERENCE" }));
      }
    });

    it("accepts a safe relative document reference", () => {
      expectValid(
        validateCreateProjectEvidenceInput(
          validInput({ sourceKind: "adr", reference: "docs/decisions/adr/ADR-0006-canonical-product-identity.md" }),
        ),
      );
    });

    it("applies a different, generic reference rule for a non-document source kind", () => {
      // Not path-shaped, but still safe under the generic rule.
      expectValid(
        validateCreateProjectEvidenceInput(
          validInput({ sourceKind: "verified_repository_state", reference: "verified:github:aryanbarak/smartflow@ae14be6" }),
        ),
      );
      // Control characters and null bytes are still rejected under the generic rule.
      const result = validateCreateProjectEvidenceInput(
        validInput({ sourceKind: "verified_repository_state", reference: `bad${String.fromCharCode(0)}ref` }),
      );
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_REFERENCE" }));
    });
  });

  describe("supersedesId and acquisitionAttemptId shape", () => {
    it("rejects a malformed supersedesId", () => {
      const result = validateCreateProjectEvidenceInput(validInput({ supersedesId: "not-a-uuid" }));
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "INVALID_SUPERSEDES_ID" }));
    });

    it("accepts a well-formed supersedesId", () => {
      expectValid(validateCreateProjectEvidenceInput(validInput({ supersedesId: VALID_SUPERSEDES_ID })));
    });

    it("rejects an unsafe or overlong acquisitionAttemptId", () => {
      expectInvalid(validateCreateProjectEvidenceInput(validInput({ acquisitionAttemptId: "has spaces" })));
      expectInvalid(validateCreateProjectEvidenceInput(validInput({ acquisitionAttemptId: "x".repeat(201) })));
      expectInvalid(validateCreateProjectEvidenceInput(validInput({ acquisitionAttemptId: "" })));
    });
  });

  it("rejects a malformed projectId", () => {
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ projectId: "not-a-uuid" })));
    expectInvalid(validateCreateProjectEvidenceInput(validInput({ projectId: "" })));
  });

  it("does not mutate or freeze the caller-owned input object", () => {
    const raw = validInput();
    const frozenBefore = Object.isFrozen(raw);
    validateCreateProjectEvidenceInput(raw);
    expect(Object.isFrozen(raw)).toBe(frozenBefore);
    expect(raw).toEqual(validInput());
  });

  it("returns a normalized value that shares no mutable reference with the input", () => {
    const raw = validInput({ notes: "  padded  " });
    const result = validateCreateProjectEvidenceInput(raw);
    expectValid<{ notes?: string }>(result);
    expect(result.value.notes).toBe("padded");
    raw.notes = "mutated after validation";
    expect(result.value.notes).toBe("padded");
  });
});
