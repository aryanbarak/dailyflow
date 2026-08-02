import { describe, expect, it } from "vitest";
import { validateCreateProjectRecordInput, validateUpdateProjectRecordInput } from "./projectRecordValidation";

function expectValid<T>(result: { valid: boolean }): asserts result is { valid: true; value: T } {
  expect(result.valid).toBe(true);
}

function expectInvalid(result: { valid: boolean }): asserts result is { valid: false; errors: unknown[] } {
  expect(result.valid).toBe(false);
}

describe("validateCreateProjectRecordInput", () => {
  it("accepts a minimal valid Software Project input and normalizes it", () => {
    const result = validateCreateProjectRecordInput({ type: "software_project", name: "  SmartFlow  " });
    expectValid(result);
    expect(result.value).toEqual({
      type: "software_project",
      name: "SmartFlow",
      enabledEvidenceSourceKinds: [],
    });
  });

  it("accepts a full valid input with repository binding, description, and evidence sources", () => {
    const result = validateCreateProjectRecordInput({
      type: "software_project",
      name: "SmartFlow",
      description: "  Personal life OS  ",
      repository: { provider: "github", owner: "aryanbarak", name: "smartflow" },
      enabledEvidenceSourceKinds: ["architecture_document", "adr"],
    });
    expectValid(result);
    expect(result.value).toEqual({
      type: "software_project",
      name: "SmartFlow",
      description: "Personal life OS",
      repository: { provider: "github", owner: "aryanbarak", name: "smartflow" },
      enabledEvidenceSourceKinds: ["architecture_document", "adr"],
    });
  });

  it("rejects an unsupported project type", () => {
    const result = validateCreateProjectRecordInput({ type: "learning_project", name: "x" });
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_PROJECT_TYPE" }));
  });

  it("rejects a missing or blank name", () => {
    expectInvalid(validateCreateProjectRecordInput({ type: "software_project", name: "" }));
    expectInvalid(validateCreateProjectRecordInput({ type: "software_project", name: "   " }));
    expectInvalid(validateCreateProjectRecordInput({ type: "software_project" }));
  });

  it("rejects a name over the length limit", () => {
    const result = validateCreateProjectRecordInput({ type: "software_project", name: "x".repeat(201) });
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "PROJECT_NAME_TOO_LONG" }));
  });

  it("rejects a description over the length limit", () => {
    const result = validateCreateProjectRecordInput({
      type: "software_project",
      name: "x",
      description: "y".repeat(2001),
    });
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "DESCRIPTION_TOO_LONG" }));
  });

  it("rejects an unknown top-level field", () => {
    const result = validateCreateProjectRecordInput({ type: "software_project", name: "x", ownerId: "someone-else" });
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_FIELD" }));
  });

  it("rejects a prototype-pollution key at the top level", () => {
    const raw = JSON.parse('{"type":"software_project","name":"x","__proto__":{"polluted":true}}');
    const result = validateCreateProjectRecordInput(raw);
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSAFE_VALUE" }));
  });

  it("rejects a non-object input", () => {
    expectInvalid(validateCreateProjectRecordInput("software_project"));
    expectInvalid(validateCreateProjectRecordInput(null));
    expectInvalid(validateCreateProjectRecordInput(["not", "an", "object"]));
  });

  describe("repository binding", () => {
    it("rejects an unsupported provider", () => {
      const result = validateCreateProjectRecordInput({
        type: "software_project",
        name: "x",
        repository: { provider: "gitlab", owner: "a", name: "b" },
      });
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_REPOSITORY_PROVIDER" }));
    });

    it("rejects a missing owner or name", () => {
      expectInvalid(
        validateCreateProjectRecordInput({
          type: "software_project",
          name: "x",
          repository: { provider: "github", owner: "", name: "b" },
        }),
      );
      expectInvalid(
        validateCreateProjectRecordInput({
          type: "software_project",
          name: "x",
          repository: { provider: "github", owner: "a" },
        }),
      );
    });

    it("rejects an unknown field inside the binding", () => {
      const result = validateCreateProjectRecordInput({
        type: "software_project",
        name: "x",
        repository: { provider: "github", owner: "a", name: "b", connectionStatus: "connected" },
      });
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_FIELD" }));
    });

    it("rejects a non-object binding", () => {
      expectInvalid(validateCreateProjectRecordInput({ type: "software_project", name: "x", repository: "github/smartflow" }));
    });
  });

  describe("evidence source kinds", () => {
    it("rejects an unsupported kind", () => {
      const result = validateCreateProjectRecordInput({
        type: "software_project",
        name: "x",
        enabledEvidenceSourceKinds: ["not_a_real_kind"],
      });
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "INVALID_EVIDENCE_SOURCE_KIND" }));
    });

    it("rejects a duplicate kind", () => {
      const result = validateCreateProjectRecordInput({
        type: "software_project",
        name: "x",
        enabledEvidenceSourceKinds: ["adr", "adr"],
      });
      expectInvalid(result);
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "DUPLICATE_EVIDENCE_SOURCE_KIND" }));
    });

    it("rejects a non-array value", () => {
      expectInvalid(
        validateCreateProjectRecordInput({ type: "software_project", name: "x", enabledEvidenceSourceKinds: "adr" }),
      );
    });
  });
});

describe("validateUpdateProjectRecordInput", () => {
  it("accepts a minimal valid update", () => {
    const result = validateUpdateProjectRecordInput({ expectedVersion: 1, name: "New name" });
    expectValid(result);
    expect(result.value).toEqual({ expectedVersion: 1, name: "New name" });
  });

  it("accepts explicit clearing of description and repository via null", () => {
    const result = validateUpdateProjectRecordInput({ expectedVersion: 3, description: null, repository: null });
    expectValid(result);
    expect(result.value).toEqual({ expectedVersion: 3, description: null, repository: null });
  });

  it("rejects a missing or non-positive expectedVersion", () => {
    expectInvalid(validateUpdateProjectRecordInput({ name: "x" }));
    expectInvalid(validateUpdateProjectRecordInput({ expectedVersion: 0, name: "x" }));
    expectInvalid(validateUpdateProjectRecordInput({ expectedVersion: 1.5, name: "x" }));
    expectInvalid(validateUpdateProjectRecordInput({ expectedVersion: -1, name: "x" }));
  });

  it("rejects an update with no editable fields", () => {
    const result = validateUpdateProjectRecordInput({ expectedVersion: 1 });
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "NO_EDITABLE_FIELDS" }));
  });

  it("rejects an attempt to change identity fields", () => {
    expectInvalid(validateUpdateProjectRecordInput({ expectedVersion: 1, id: "other-id", name: "x" }));
    expectInvalid(validateUpdateProjectRecordInput({ expectedVersion: 1, ownerId: "someone-else", name: "x" }));
    expectInvalid(validateUpdateProjectRecordInput({ expectedVersion: 1, type: "software_project", name: "x" }));
  });

  it("rejects a blank name", () => {
    const result = validateUpdateProjectRecordInput({ expectedVersion: 1, name: "   " });
    expectInvalid(result);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "MISSING_PROJECT_NAME" }));
  });

  it("normalizes a full valid update", () => {
    const result = validateUpdateProjectRecordInput({
      expectedVersion: 2,
      name: "  Renamed  ",
      description: "  Updated  ",
      repository: { provider: "github", owner: "a", name: "b" },
      enabledEvidenceSourceKinds: ["adr"],
    });
    expectValid(result);
    expect(result.value).toEqual({
      expectedVersion: 2,
      name: "Renamed",
      description: "Updated",
      repository: { provider: "github", owner: "a", name: "b" },
      enabledEvidenceSourceKinds: ["adr"],
    });
  });
});
