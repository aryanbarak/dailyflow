import { describe, expect, it } from "vitest";
import { validateCreateProjectEvidenceObservationTextInput } from "./projectEvidenceObservationValidation";
import { MAX_TEXT_OBSERVATION_BYTES } from "./projectEvidenceObservationTypes";

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    textContent: "# Project Domain\n\nCanonical architecture.\n",
    mimeType: "text/markdown",
    ...overrides,
  };
}

function expectValid<T>(result: { valid: boolean }): asserts result is { valid: true; value: T } {
  expect(result.valid).toBe(true);
}

function expectInvalid(result: { valid: boolean }): asserts result is { valid: false; errors: unknown[] } {
  expect(result.valid).toBe(false);
}

describe("validateCreateProjectEvidenceObservationTextInput", () => {
  it("accepts a valid text observation and normalizes it, with a strict payloadKind", () => {
    const result = validateCreateProjectEvidenceObservationTextInput(validInput());
    expectValid(result);
    expect(result.value).toEqual({
      payloadKind: "text",
      textContent: "# Project Domain\n\nCanonical architecture.\n",
      mimeType: "text/markdown",
      byteLength: new TextEncoder().encode("# Project Domain\n\nCanonical architecture.\n").length,
    });
  });

  it("accepts text/plain as well as text/markdown", () => {
    expectValid(validateCreateProjectEvidenceObservationTextInput(validInput({ mimeType: "text/plain" })));
  });

  it("computes byteLength as the actual encoded UTF-8 byte length, not the character length", () => {
    // Each euro sign is 1 character but 3 UTF-8 bytes.
    const text = "€€€";
    const result = validateCreateProjectEvidenceObservationTextInput(validInput({ textContent: text }));
    expectValid<{ byteLength: number }>(result);
    expect(result.value.byteLength).toBe(9);
    expect(result.value.byteLength).not.toBe(text.length);
  });

  it("rejects malformed or null input", () => {
    expectInvalid(validateCreateProjectEvidenceObservationTextInput(null));
    expectInvalid(validateCreateProjectEvidenceObservationTextInput(undefined));
    expectInvalid(validateCreateProjectEvidenceObservationTextInput("a string"));
    expectInvalid(validateCreateProjectEvidenceObservationTextInput(42));
    expectInvalid(validateCreateProjectEvidenceObservationTextInput(["not", "an", "object"]));
  });

  it("rejects a missing or empty textContent", () => {
    const missing = validateCreateProjectEvidenceObservationTextInput(validInput({ textContent: undefined }));
    expectInvalid(missing);
    expect(missing.errors).toContainEqual(expect.objectContaining({ code: "MISSING_TEXT_CONTENT" }));

    const empty = validateCreateProjectEvidenceObservationTextInput(validInput({ textContent: "" }));
    expectInvalid(empty);
    expect(empty.errors).toContainEqual(expect.objectContaining({ code: "MISSING_TEXT_CONTENT" }));
  });

  it("rejects a non-string textContent", () => {
    for (const value of [42, true, {}, [], null]) {
      const result = validateCreateProjectEvidenceObservationTextInput(validInput({ textContent: value }));
      expectInvalid(result);
    }
  });

  it("rejects textContent containing an unpaired UTF-16 surrogate", () => {
    const result = validateCreateProjectEvidenceObservationTextInput(validInput({ textContent: "broken \uD800 text" }));
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "INVALID_UTF8_TEXT_CONTENT" }));
  });

  it("accepts textContent exactly at the maximum byte length", () => {
    const text = "x".repeat(MAX_TEXT_OBSERVATION_BYTES);
    expectValid(validateCreateProjectEvidenceObservationTextInput(validInput({ textContent: text })));
  });

  it("rejects textContent exceeding the maximum byte length", () => {
    const text = "x".repeat(MAX_TEXT_OBSERVATION_BYTES + 1);
    const result = validateCreateProjectEvidenceObservationTextInput(validInput({ textContent: text }));
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "TEXT_CONTENT_TOO_LARGE" }));
  });

  it("rejects an unsupported MIME type", () => {
    for (const mimeType of ["application/pdf", "image/png", "application/json", ""]) {
      const result = validateCreateProjectEvidenceObservationTextInput(validInput({ mimeType }));
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_MIME_TYPE" }));
    }
  });

  it("rejects a non-string MIME type", () => {
    expectInvalid(validateCreateProjectEvidenceObservationTextInput(validInput({ mimeType: 42 })));
  });

  describe("gitRevision", () => {
    it("accepts a well-formed 40-character lowercase hex gitRevision", () => {
      expectValid(validateCreateProjectEvidenceObservationTextInput(validInput({ gitRevision: "a".repeat(40) })));
    });

    it("accepts omitting gitRevision entirely", () => {
      expectValid(validateCreateProjectEvidenceObservationTextInput(validInput()));
    });

    it("rejects a gitRevision of the wrong length", () => {
      expectInvalid(validateCreateProjectEvidenceObservationTextInput(validInput({ gitRevision: "a".repeat(39) })));
      expectInvalid(validateCreateProjectEvidenceObservationTextInput(validInput({ gitRevision: "a".repeat(41) })));
    });

    it("rejects an uppercase or non-hex gitRevision", () => {
      expectInvalid(validateCreateProjectEvidenceObservationTextInput(validInput({ gitRevision: "A".repeat(40) })));
      expectInvalid(validateCreateProjectEvidenceObservationTextInput(validInput({ gitRevision: "g".repeat(40) })));
    });

    it("rejects a non-string gitRevision", () => {
      expectInvalid(validateCreateProjectEvidenceObservationTextInput(validInput({ gitRevision: 12345 })));
    });
  });

  it("rejects an unknown top-level field", () => {
    const result = validateCreateProjectEvidenceObservationTextInput(validInput({ artifactPath: "/etc/passwd" }));
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_FIELD" }));
  });

  it("rejects byteLength or contentHash supplied by the caller as unknown fields -- both are always server-computed", () => {
    const withByteLength = validateCreateProjectEvidenceObservationTextInput(validInput({ byteLength: 5 }));
    expectInvalid(withByteLength);
    expect(withByteLength.errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_FIELD" }));

    const withHash = validateCreateProjectEvidenceObservationTextInput(
      validInput({ contentHash: "0".repeat(64) }),
    );
    expectInvalid(withHash);
    expect(withHash.errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_FIELD" }));
  });

  it("rejects a prototype-pollution key", () => {
    const raw = JSON.parse(`{"__proto__":{"polluted":true},${JSON.stringify(validInput()).slice(1)}`);
    const result = validateCreateProjectEvidenceObservationTextInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
  });

  it("rejects constructor/prototype as object keys", () => {
    for (const key of ["constructor", "prototype"]) {
      const raw: Record<string, unknown> = { ...validInput() };
      Object.defineProperty(raw, key, { value: {}, enumerable: true, configurable: true });
      const result = validateCreateProjectEvidenceObservationTextInput(raw);
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
    }
  });

  it("rejects a throwing getter on a top-level field without invoking it more than once or crashing", () => {
    const raw: Record<string, unknown> = { ...validInput() };
    let readCount = 0;
    Object.defineProperty(raw, "textContent", {
      enumerable: true,
      get() {
        readCount += 1;
        throw new Error("hostile getter");
      },
    });
    expect(() => validateCreateProjectEvidenceObservationTextInput(raw)).not.toThrow();
    const result = validateCreateProjectEvidenceObservationTextInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
    expect(readCount).toBe(0);
  });

  it("rejects a plain (non-throwing) accessor property on a top-level field", () => {
    const raw: Record<string, unknown> = { ...validInput() };
    Object.defineProperty(raw, "mimeType", { enumerable: true, get: () => "text/markdown" });
    const result = validateCreateProjectEvidenceObservationTextInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
  });

  it("does not mutate or freeze the caller-owned input object", () => {
    const raw = validInput();
    const frozenBefore = Object.isFrozen(raw);
    validateCreateProjectEvidenceObservationTextInput(raw);
    expect(Object.isFrozen(raw)).toBe(frozenBefore);
    expect(raw).toEqual(validInput());
  });

  it("returns a normalized value that shares no mutable reference with the input", () => {
    const raw = validInput();
    const result = validateCreateProjectEvidenceObservationTextInput(raw);
    expectValid<{ textContent: string }>(result);
    raw.textContent = "mutated after validation";
    expect(result.value.textContent).toBe("# Project Domain\n\nCanonical architecture.\n");
  });
});
