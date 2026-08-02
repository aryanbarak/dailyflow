// SmartFlow Slice 4B -- ProjectEvidence Foundation.
//
// Pure, deterministic validation: untrusted input -> normalized, safe-to-
// persist value, or a typed list of validation issues. No I/O, no Supabase
// call, no clock read, no randomness.
//
// Unlike projectRecordValidation.ts (Slice 3), which read input fields via
// direct property access, this module reads the raw input exclusively
// through property descriptors before any field-specific check runs --
// mirroring projectContextBuilder.ts's `scanForUnsafeValues` /
// `getEnumerableOwnDescriptors` discipline, reimplemented locally so this
// module has no import dependency on projectContextBuilder.ts's internals.
// This is a direct, deliberate correction of a real gap Slice 3 shipped
// with: a throwing/accessor property on a top-level input field could
// previously escape validation as an uncaught exception rather than a typed
// `INVALID_INPUT` result. Here, no field is ever read via `input.field`
// until the entire raw input tree has already been proven free of accessor
// properties, unsafe keys, cycles, non-plain-object prototypes, and
// functions/symbols/bigint/non-finite numbers.

import {
  PROJECT_EVIDENCE_CLASSIFICATIONS,
  type CreateProjectEvidenceInput,
  type NormalizedCreateProjectEvidenceInput,
  type ProjectEvidenceClassification,
  type ProjectEvidenceValidationErrorCode,
  type ProjectEvidenceValidationIssue,
  type ProjectEvidenceValidationResult,
} from "./projectEvidenceTypes";
import type { ProjectSourceKind } from "./projectContextTypes";

const VALID_SOURCE_KINDS = new Set<ProjectSourceKind>([
  "repository_document",
  "architecture_document",
  "adr",
  "roadmap_document",
  "product_direction_document",
  "project_status_document",
  "verified_repository_state",
  "verified_integration_evidence",
]);

const VALID_CLASSIFICATIONS = new Set<ProjectEvidenceClassification>(PROJECT_EVIDENCE_CLASSIFICATIONS);

/** Source kinds whose reference is a relative repository-document-style path. Every other kind uses the generic bounded-string reference rule (see `isSafeGenericReference`) -- source-kind-specific validation, not one permissive global regex. */
const PATH_LIKE_SOURCE_KINDS = new Set<ProjectSourceKind>([
  "repository_document",
  "architecture_document",
  "adr",
  "roadmap_document",
  "product_direction_document",
  "project_status_document",
]);

const TITLE_MAX_LENGTH = 200;
const REFERENCE_MAX_LENGTH = 500;
const ADAPTER_IDENTITY_MAX_LENGTH = 200;
const ADAPTER_VERSION_MAX_LENGTH = 100;
const VERIFICATION_METHOD_MAX_LENGTH = 200;
const SOURCE_REVISION_MAX_LENGTH = 200;
const UNCERTAINTY_MAX_LENGTH = 500;
const NOTES_MAX_LENGTH = 2000;
const ACQUISITION_ATTEMPT_ID_MAX_LENGTH = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACQUISITION_ATTEMPT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CREATE_INPUT_KEYS = new Set([
  "projectId",
  "sourceKind",
  "classification",
  "title",
  "reference",
  "collectedAt",
  "adapterIdentity",
  "adapterVersion",
  "verificationMethod",
  "sourceRevision",
  "confidence",
  "uncertainty",
  "notes",
  "supersedesId",
  "acquisitionAttemptId",
]);

/** Built via fromCharCode rather than a literal escape so the source text never has to contain an actual embedded NUL character. */
const NULL_BYTE_CHARACTER = String.fromCharCode(0);

function containsNullByte(value: string): boolean {
  return value.includes(NULL_BYTE_CHARACTER);
}

function containsControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

class IssueCollector {
  readonly issues: ProjectEvidenceValidationIssue[] = [];

  add(code: ProjectEvidenceValidationErrorCode, message: string, path?: string) {
    this.issues.push(path ? { code, message, path } : { code, message });
  }

  get hasIssues() {
    return this.issues.length > 0;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Own enumerable property descriptors of an object, without ever reading a
 * property's value through normal access (`obj[key]` or
 * `Object.entries`/`Object.values`) -- both invoke getters immediately,
 * including hostile ones that throw. `Object.getOwnPropertyDescriptors` is
 * inert: it never calls a getter or setter.
 */
function getEnumerableOwnDescriptors(value: object): Array<[string, PropertyDescriptor]> {
  return Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([, descriptor]) => descriptor.enumerable);
}

function isAccessorDescriptor(descriptor: PropertyDescriptor): boolean {
  return "get" in descriptor || "set" in descriptor;
}

/**
 * Defensively walks arbitrary input to reject functions, symbols, bigint,
 * non-finite numbers, cyclic references, non-plain-object prototypes
 * (class instances), prototype-pollution keys, and accessor (getter/setter)
 * properties -- reimplemented locally from projectContextBuilder.ts's
 * `scanForUnsafeValues` so this module has no import dependency on it.
 * Accessor properties are rejected by inspecting descriptors, never by
 * reading the property first.
 */
function scanForUnsafeValues(value: unknown, path: string, collector: IssueCollector, seen: WeakSet<object>): void {
  if (value === null || value === undefined) return;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return;
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      collector.add("UNSAFE_VALUE", "Non-finite numbers are not allowed.", path);
    }
    return;
  }
  if (valueType === "function" || valueType === "symbol" || valueType === "bigint") {
    collector.add("UNSAFE_VALUE", `${valueType} values are not allowed.`, path);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      collector.add("UNSAFE_VALUE", "Cyclic references are not allowed.", path);
      return;
    }
    seen.add(value);
    value.forEach((entry, index) => scanForUnsafeValues(entry, `${path}[${index}]`, collector, seen));
    seen.delete(value);
    return;
  }
  if (valueType === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      collector.add("UNSAFE_VALUE", "Only plain objects are allowed.", path);
      return;
    }
    if (seen.has(value as object)) {
      collector.add("UNSAFE_VALUE", "Cyclic references are not allowed.", path);
      return;
    }
    seen.add(value as object);
    for (const [key, descriptor] of getEnumerableOwnDescriptors(value as object)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) {
        collector.add("UNSAFE_VALUE", `${key} is not allowed as an object key.`, `${path}.${key}`);
        continue;
      }
      if (isAccessorDescriptor(descriptor)) {
        collector.add(
          "UNSAFE_VALUE",
          `${key} is an accessor property (getter/setter) and is not allowed.`,
          `${path}.${key}`,
        );
        continue;
      }
      scanForUnsafeValues(descriptor.value, `${path}.${key}`, collector, seen);
    }
    seen.delete(value as object);
    return;
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>, collector: IssueCollector) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      collector.add("UNKNOWN_FIELD", `Unknown field "${key}" is not allowed.`, key);
    }
  }
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Explicit segment-based validation for a repository-document-style
 * reference -- deliberately not a single regex, matching
 * projectContextBuilder.ts's `isSafeRepositoryDocumentReference` reasoning:
 * a single regex is exactly what lets a `../`-traversal string through
 * (a leading alnum check does not stop `..` segments appearing later).
 * Percent-encoded sequences are rejected outright rather than decoded and
 * re-checked.
 */
function isSafeDocumentReference(reference: string): boolean {
  if (reference.length === 0 || reference.length > REFERENCE_MAX_LENGTH) return false;
  if (containsNullByte(reference)) return false;
  if (reference.includes("%")) return false;
  if (reference.includes("\\")) return false;
  if (reference.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(reference)) return false;

  const segments = reference.split("/");
  for (const segment of segments) {
    if (segment.length === 0) return false;
    if (segment === "." || segment === "..") return false;
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) return false;
  }
  return true;
}

/**
 * Generic bounded-string reference rule for non-document source kinds
 * (e.g. a future provider record identifier). Deliberately not the same
 * rule as `isSafeDocumentReference`: this reference is not assumed to be a
 * filesystem path.
 */
function isSafeGenericReference(reference: string): boolean {
  if (reference.length === 0 || reference.length > REFERENCE_MAX_LENGTH) return false;
  if (containsNullByte(reference)) return false;
  if (containsControlCharacter(reference)) return false;
  if (reference.includes("\\")) return false;
  return true;
}

function isSafeReference(sourceKind: ProjectSourceKind, reference: string): boolean {
  return PATH_LIKE_SOURCE_KINDS.has(sourceKind)
    ? isSafeDocumentReference(reference)
    : isSafeGenericReference(reference);
}

function isValidCollectedAt(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isValidAcquisitionAttemptId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= ACQUISITION_ATTEMPT_ID_MAX_LENGTH &&
    ACQUISITION_ATTEMPT_ID_PATTERN.test(value)
  );
}

/**
 * Validates and normalizes create input. Accepts `unknown` deliberately.
 * Every field is read only after `scanForUnsafeValues` has already proven
 * the whole raw input tree contains no accessor property, so a
 * throwing/side-effecting getter on any field -- top-level or nested --
 * is caught here as a typed `UNSAFE_VALUE` issue, never as an uncaught
 * exception.
 */
export function validateCreateProjectEvidenceInput(
  raw: unknown,
): ProjectEvidenceValidationResult<NormalizedCreateProjectEvidenceInput> {
  const collector = new IssueCollector();

  if (!isPlainObject(raw)) {
    collector.add("UNSAFE_VALUE", "Input must be a plain object.");
    return { valid: false, errors: collector.issues };
  }

  scanForUnsafeValues(raw, "input", collector, new WeakSet());
  if (collector.hasIssues) {
    return { valid: false, errors: collector.issues };
  }

  rejectUnknownKeys(raw, CREATE_INPUT_KEYS, collector);

  // Safe from here on: scanForUnsafeValues has already proven `raw` has no
  // accessor property anywhere, so direct property access below can never
  // invoke a hostile getter.
  const input = raw as Partial<CreateProjectEvidenceInput>;

  if (!isNonEmptyTrimmedString(input.projectId)) {
    collector.add("MISSING_PROJECT_ID", "Project id is required.", "projectId");
  } else if (!isValidUuid(input.projectId.trim())) {
    collector.add("INVALID_PROJECT_ID", "Project id must be a valid identifier.", "projectId");
  }

  if (typeof input.sourceKind !== "string" || !VALID_SOURCE_KINDS.has(input.sourceKind as ProjectSourceKind)) {
    collector.add(
      "UNSUPPORTED_SOURCE_KIND",
      `Source kind must be one of: ${[...VALID_SOURCE_KINDS].join(", ")}.`,
      "sourceKind",
    );
  }

  if (
    typeof input.classification !== "string" ||
    !VALID_CLASSIFICATIONS.has(input.classification as ProjectEvidenceClassification)
  ) {
    collector.add(
      "UNSUPPORTED_CLASSIFICATION",
      `Classification must be one of: ${[...VALID_CLASSIFICATIONS].join(", ")}.`,
      "classification",
    );
  }

  if (!isNonEmptyTrimmedString(input.title)) {
    collector.add("MISSING_TITLE", "Title is required.", "title");
  } else if (input.title.trim().length > TITLE_MAX_LENGTH) {
    collector.add("TITLE_TOO_LONG", `Title must be at most ${TITLE_MAX_LENGTH} characters.`, "title");
  }

  const sourceKindForReferenceCheck =
    typeof input.sourceKind === "string" && VALID_SOURCE_KINDS.has(input.sourceKind as ProjectSourceKind)
      ? (input.sourceKind as ProjectSourceKind)
      : undefined;
  if (!isNonEmptyTrimmedString(input.reference)) {
    collector.add("MISSING_REFERENCE", "Reference is required.", "reference");
  } else if (input.reference.length > REFERENCE_MAX_LENGTH) {
    collector.add("REFERENCE_TOO_LONG", `Reference must be at most ${REFERENCE_MAX_LENGTH} characters.`, "reference");
  } else if (sourceKindForReferenceCheck && !isSafeReference(sourceKindForReferenceCheck, input.reference)) {
    collector.add("UNSAFE_REFERENCE", "Reference is not a safe value for this source kind.", "reference");
  }

  if (!isValidCollectedAt(input.collectedAt)) {
    collector.add("INVALID_COLLECTED_AT", "collectedAt must be a valid ISO 8601 timestamp.", "collectedAt");
  }

  if (!isNonEmptyTrimmedString(input.adapterIdentity)) {
    collector.add("MISSING_ADAPTER_IDENTITY", "Adapter identity is required.", "adapterIdentity");
  } else if (input.adapterIdentity.trim().length > ADAPTER_IDENTITY_MAX_LENGTH) {
    collector.add(
      "ADAPTER_IDENTITY_TOO_LONG",
      `Adapter identity must be at most ${ADAPTER_IDENTITY_MAX_LENGTH} characters.`,
      "adapterIdentity",
    );
  }

  if (!isNonEmptyTrimmedString(input.adapterVersion)) {
    collector.add("MISSING_ADAPTER_VERSION", "Adapter version is required.", "adapterVersion");
  } else if (input.adapterVersion.trim().length > ADAPTER_VERSION_MAX_LENGTH) {
    collector.add(
      "ADAPTER_VERSION_TOO_LONG",
      `Adapter version must be at most ${ADAPTER_VERSION_MAX_LENGTH} characters.`,
      "adapterVersion",
    );
  }

  if (!isNonEmptyTrimmedString(input.verificationMethod)) {
    collector.add("MISSING_VERIFICATION_METHOD", "Verification method is required.", "verificationMethod");
  } else if (input.verificationMethod.trim().length > VERIFICATION_METHOD_MAX_LENGTH) {
    collector.add(
      "VERIFICATION_METHOD_TOO_LONG",
      `Verification method must be at most ${VERIFICATION_METHOD_MAX_LENGTH} characters.`,
      "verificationMethod",
    );
  }

  if (input.sourceRevision !== undefined) {
    if (typeof input.sourceRevision !== "string" || input.sourceRevision.trim().length === 0) {
      collector.add("SOURCE_REVISION_TOO_LONG", "Source revision must be a non-empty string.", "sourceRevision");
    } else if (input.sourceRevision.trim().length > SOURCE_REVISION_MAX_LENGTH) {
      collector.add(
        "SOURCE_REVISION_TOO_LONG",
        `Source revision must be at most ${SOURCE_REVISION_MAX_LENGTH} characters.`,
        "sourceRevision",
      );
    }
  }

  if (input.confidence !== undefined) {
    if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      collector.add("INVALID_CONFIDENCE", "Confidence must be a finite number between 0 and 1.", "confidence");
    }
  }

  if (input.uncertainty !== undefined) {
    if (typeof input.uncertainty !== "string" || input.uncertainty.trim().length === 0) {
      collector.add("UNCERTAINTY_TOO_LONG", "Uncertainty must be a non-empty string.", "uncertainty");
    } else if (input.uncertainty.trim().length > UNCERTAINTY_MAX_LENGTH) {
      collector.add("UNCERTAINTY_TOO_LONG", `Uncertainty must be at most ${UNCERTAINTY_MAX_LENGTH} characters.`, "uncertainty");
    }
  }

  if (input.notes !== undefined) {
    if (typeof input.notes !== "string") {
      collector.add("NOTES_TOO_LONG", "Notes must be a string.", "notes");
    } else if (input.notes.length > NOTES_MAX_LENGTH) {
      collector.add("NOTES_TOO_LONG", `Notes must be at most ${NOTES_MAX_LENGTH} characters.`, "notes");
    }
  }

  if (input.supersedesId !== undefined) {
    if (typeof input.supersedesId !== "string" || !isValidUuid(input.supersedesId)) {
      collector.add("INVALID_SUPERSEDES_ID", "supersedesId must be a valid identifier.", "supersedesId");
    }
  }

  if (input.acquisitionAttemptId !== undefined && !isValidAcquisitionAttemptId(input.acquisitionAttemptId)) {
    collector.add(
      "INVALID_ACQUISITION_ATTEMPT_ID",
      `acquisitionAttemptId must be a non-empty, bounded, safe-character string of at most ${ACQUISITION_ATTEMPT_ID_MAX_LENGTH} characters.`,
      "acquisitionAttemptId",
    );
  }

  if (collector.hasIssues) {
    return { valid: false, errors: collector.issues };
  }

  const normalized: NormalizedCreateProjectEvidenceInput = {
    projectId: (input.projectId as string).trim(),
    sourceKind: input.sourceKind as ProjectSourceKind,
    classification: input.classification as ProjectEvidenceClassification,
    title: (input.title as string).trim(),
    reference: input.reference as string,
    collectedAt: input.collectedAt as string,
    adapterIdentity: (input.adapterIdentity as string).trim(),
    adapterVersion: (input.adapterVersion as string).trim(),
    verificationMethod: (input.verificationMethod as string).trim(),
  };
  if (input.sourceRevision !== undefined) normalized.sourceRevision = (input.sourceRevision as string).trim();
  if (input.confidence !== undefined) normalized.confidence = input.confidence as number;
  if (input.uncertainty !== undefined) normalized.uncertainty = (input.uncertainty as string).trim();
  if (input.notes !== undefined) {
    const trimmed = (input.notes as string).trim();
    if (trimmed.length > 0) normalized.notes = trimmed;
  }
  if (input.supersedesId !== undefined) normalized.supersedesId = input.supersedesId as string;
  if (input.acquisitionAttemptId !== undefined) normalized.acquisitionAttemptId = input.acquisitionAttemptId as string;

  return { valid: true, value: normalized };
}
