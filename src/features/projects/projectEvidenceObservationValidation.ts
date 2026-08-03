// SmartFlow -- ProjectEvidence Observation Foundation (ADR-0007).
//
// Pure, deterministic, synchronous validation: untrusted input -> a
// shape-validated text payload, or a typed list of validation issues. No
// I/O, no Supabase call, no clock read, no randomness -- and, deliberately,
// no cryptographic hash computation either, since `globalThis.crypto.subtle`
// is asynchronous; hashing happens one layer up, immediately before
// persistence (projectEvidenceRepository.ts).
//
// Reads the raw input exclusively through property descriptors before any
// field-specific check runs, exactly mirroring projectEvidenceValidation.ts's
// own discipline -- a throwing/accessor property on `textContent` or
// `mimeType` must surface as a typed `UNSAFE_VALUE` issue, never as an
// uncaught exception.

import {
  MAX_TEXT_OBSERVATION_BYTES,
  PROJECT_EVIDENCE_OBSERVATION_TEXT_MIME_TYPES,
  type CreateProjectEvidenceObservationTextInput,
  type ProjectEvidenceObservationValidationErrorCode,
  type ProjectEvidenceObservationValidationIssue,
  type ProjectEvidenceObservationValidationResult,
  type ProjectEvidenceObservationTextMimeType,
  type ValidatedProjectEvidenceObservationTextInput,
} from "./projectEvidenceObservationTypes";

const VALID_MIME_TYPES = new Set<string>(PROJECT_EVIDENCE_OBSERVATION_TEXT_MIME_TYPES);

const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/;

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CREATE_INPUT_KEYS = new Set(["textContent", "mimeType", "gitRevision"]);

/**
 * Detects an unpaired UTF-16 surrogate -- a string containing one cannot be
 * losslessly round-tripped through UTF-8 encode/decode; `TextEncoder`
 * silently substitutes U+FFFD for it instead of throwing, which would
 * quietly break the "the hash covers the exact bytes represented by
 * text_content" guarantee. Rejected outright rather than silently repaired.
 */
const UNPAIRED_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

class IssueCollector {
  readonly issues: ProjectEvidenceObservationValidationIssue[] = [];

  add(code: ProjectEvidenceObservationValidationErrorCode, message: string, path?: string) {
    this.issues.push(path ? { code, message, path } : { code, message });
  }

  get hasIssues() {
    return this.issues.length > 0;
  }
}

/** Reads a top-level field only via its property descriptor, never via direct access -- a throwing/accessor getter on any of this input's three flat fields must surface as a typed issue, never an uncaught exception. This input shape has no nested objects to recurse into, so a full descriptor-tree walk is not needed here, only this narrow, flat guard. */
function readSafeField(input: object, key: string, collector: IssueCollector): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return undefined;
  if ("get" in descriptor || "set" in descriptor) {
    collector.add("UNSAFE_VALUE", `${key} is an accessor property (getter/setter) and is not allowed.`, key);
    return undefined;
  }
  return descriptor.value;
}

function rejectUnknownKeys(value: object, collector: IssueCollector) {
  for (const key of Object.keys(value)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) {
      collector.add("UNSAFE_VALUE", `${key} is not allowed as an object key.`, key);
      continue;
    }
    if (!CREATE_INPUT_KEYS.has(key)) {
      collector.add("UNKNOWN_FIELD", `Unknown field "${key}" is not allowed.`, key);
    }
  }
}

export function validateCreateProjectEvidenceObservationTextInput(
  raw: unknown,
): ProjectEvidenceObservationValidationResult<ValidatedProjectEvidenceObservationTextInput> {
  const collector = new IssueCollector();

  if (!isPlainObject(raw)) {
    collector.add("UNSAFE_VALUE", "Observation input must be a plain object.");
    return { valid: false, errors: collector.issues };
  }

  rejectUnknownKeys(raw, collector);

  const textContentValue = readSafeField(raw, "textContent", collector);
  const mimeTypeValue = readSafeField(raw, "mimeType", collector);
  const gitRevisionValue = readSafeField(raw, "gitRevision", collector);
  if (collector.hasIssues) {
    return { valid: false, errors: collector.issues };
  }

  if (typeof textContentValue !== "string" || textContentValue.length === 0) {
    collector.add("MISSING_TEXT_CONTENT", "textContent is required and must be a non-empty string.", "textContent");
  } else if (UNPAIRED_SURROGATE_PATTERN.test(textContentValue)) {
    collector.add("INVALID_UTF8_TEXT_CONTENT", "textContent contains an unpaired UTF-16 surrogate.", "textContent");
  }

  let byteLength = 0;
  if (typeof textContentValue === "string" && textContentValue.length > 0 && !UNPAIRED_SURROGATE_PATTERN.test(textContentValue)) {
    byteLength = new TextEncoder().encode(textContentValue).length;
    if (byteLength === 0) {
      collector.add("EMPTY_TEXT_CONTENT", "textContent must encode to at least one UTF-8 byte.", "textContent");
    } else if (byteLength > MAX_TEXT_OBSERVATION_BYTES) {
      collector.add(
        "TEXT_CONTENT_TOO_LARGE",
        `textContent must encode to at most ${MAX_TEXT_OBSERVATION_BYTES} bytes.`,
        "textContent",
      );
    }
  }

  if (typeof mimeTypeValue !== "string" || !VALID_MIME_TYPES.has(mimeTypeValue)) {
    collector.add(
      "UNSUPPORTED_MIME_TYPE",
      `mimeType must be one of: ${[...VALID_MIME_TYPES].join(", ")}.`,
      "mimeType",
    );
  }

  if (gitRevisionValue !== undefined) {
    if (typeof gitRevisionValue !== "string" || !GIT_REVISION_PATTERN.test(gitRevisionValue)) {
      collector.add(
        "INVALID_GIT_REVISION",
        "gitRevision must be a 40-character lowercase hexadecimal string.",
        "gitRevision",
      );
    }
  }

  if (collector.hasIssues) {
    return { valid: false, errors: collector.issues };
  }

  const normalized: ValidatedProjectEvidenceObservationTextInput = {
    payloadKind: "text",
    textContent: textContentValue as string,
    mimeType: mimeTypeValue as ProjectEvidenceObservationTextMimeType,
    byteLength,
  };
  if (gitRevisionValue !== undefined) normalized.gitRevision = gitRevisionValue as string;

  return { valid: true, value: normalized };
}

export type { CreateProjectEvidenceObservationTextInput };
