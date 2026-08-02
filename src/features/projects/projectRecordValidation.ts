// SmartFlow Slice 3 -- ProjectRecord Foundation.
//
// Pure, deterministic validation: untrusted input -> normalized, safe-to-
// persist value, or a typed list of validation issues. No I/O, no Supabase
// call, no clock read, no randomness -- mirrors projectContextBuilder.ts's
// validate-then-normalize discipline, scoped down to ProjectRecord's flatter
// shape (a bounded set of top-level fields and one optional flat repository
// object, not a nested evidence graph), so a lighter, purpose-built scan is
// used here instead of importing that module's generic recursive scanner.

import {
  PROJECT_RECORD_EVIDENCE_SOURCE_KINDS,
  type CreateProjectRecordInput,
  type NormalizedCreateProjectRecordInput,
  type NormalizedProjectRecordConfigChanges,
  type ProjectRecordRepositoryBinding,
  type ProjectRecordRepositoryProvider,
  type ProjectRecordValidationErrorCode,
  type ProjectRecordValidationIssue,
  type ProjectRecordValidationResult,
  type UpdateProjectRecordInput,
} from "./projectRecordTypes";
import type { ProjectSourceKind, ProjectType } from "./projectContextTypes";

const SUPPORTED_PROJECT_TYPES = new Set<ProjectType>(["software_project"]);
const SUPPORTED_REPOSITORY_PROVIDERS = new Set<ProjectRecordRepositoryProvider>(["github"]);
const VALID_EVIDENCE_SOURCE_KINDS = new Set<ProjectSourceKind>(PROJECT_RECORD_EVIDENCE_SOURCE_KINDS);
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;
const REPOSITORY_FIELD_MAX_LENGTH = 200;

class IssueCollector {
  readonly issues: ProjectRecordValidationIssue[] = [];

  add(code: ProjectRecordValidationErrorCode, message: string, path?: string) {
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

/** Rejects prototype-pollution keys and non-own/inherited access without ever invoking a getter -- reads via `hasOwnProperty` + bracket access only after the key is known safe. */
function hasUnsafeOwnKey(value: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(value)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) return key;
  }
  return undefined;
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Every field an object of this shape is allowed to declare -- anything else is an unknown field, rejected rather than silently ignored. */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  collector: IssueCollector,
  path: string,
) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      collector.add("UNKNOWN_FIELD", `Unknown field "${key}" is not allowed.`, path ? `${path}.${key}` : key);
    }
  }
}

const REPOSITORY_BINDING_KEYS = new Set(["provider", "owner", "name"]);

function validateRepositoryBinding(
  value: unknown,
  collector: IssueCollector,
  path: string,
): ProjectRecordRepositoryBinding | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isPlainObject(value)) {
    collector.add("INVALID_REPOSITORY_BINDING", "Repository binding must be a plain object.", path);
    return undefined;
  }
  const unsafeKey = hasUnsafeOwnKey(value);
  if (unsafeKey) {
    collector.add("UNSAFE_VALUE", `${unsafeKey} is not allowed as an object key.`, `${path}.${unsafeKey}`);
    return undefined;
  }
  rejectUnknownKeys(value, REPOSITORY_BINDING_KEYS, collector, path);

  const { provider, owner, name } = value;
  let ok = true;

  if (typeof provider !== "string" || !SUPPORTED_REPOSITORY_PROVIDERS.has(provider as ProjectRecordRepositoryProvider)) {
    collector.add("UNSUPPORTED_REPOSITORY_PROVIDER", `Repository provider must be one of: ${[...SUPPORTED_REPOSITORY_PROVIDERS].join(", ")}.`, `${path}.provider`);
    ok = false;
  }
  if (!isNonEmptyTrimmedString(owner) || owner.length > REPOSITORY_FIELD_MAX_LENGTH) {
    collector.add("INVALID_REPOSITORY_BINDING", `Repository owner must be a non-empty string of at most ${REPOSITORY_FIELD_MAX_LENGTH} characters.`, `${path}.owner`);
    ok = false;
  }
  if (!isNonEmptyTrimmedString(name) || name.length > REPOSITORY_FIELD_MAX_LENGTH) {
    collector.add("INVALID_REPOSITORY_BINDING", `Repository name must be a non-empty string of at most ${REPOSITORY_FIELD_MAX_LENGTH} characters.`, `${path}.name`);
    ok = false;
  }
  if (!ok) return undefined;

  return {
    provider: provider as ProjectRecordRepositoryProvider,
    owner: (owner as string).trim(),
    name: (name as string).trim(),
  };
}

function validateEvidenceSourceKinds(
  value: unknown,
  collector: IssueCollector,
  path: string,
): readonly ProjectSourceKind[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    collector.add("INVALID_EVIDENCE_SOURCE_KIND", "Enabled evidence source kinds must be an array.", path);
    return undefined;
  }
  const seen = new Set<string>();
  const result: ProjectSourceKind[] = [];
  let ok = true;
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !VALID_EVIDENCE_SOURCE_KINDS.has(entry as ProjectSourceKind)) {
      collector.add("INVALID_EVIDENCE_SOURCE_KIND", `"${String(entry)}" is not a supported evidence source kind.`, `${path}[${index}]`);
      ok = false;
      return;
    }
    if (seen.has(entry)) {
      collector.add("DUPLICATE_EVIDENCE_SOURCE_KIND", `"${entry}" is enabled more than once.`, `${path}[${index}]`);
      ok = false;
      return;
    }
    seen.add(entry);
    result.push(entry as ProjectSourceKind);
  });
  if (!ok) return undefined;
  return result;
}

const CREATE_INPUT_KEYS = new Set(["type", "name", "description", "repository", "enabledEvidenceSourceKinds"]);

/**
 * Validates and normalizes create input. Accepts `unknown` deliberately: the
 * caller-typed `CreateProjectRecordInput` shape does not, by itself, prove
 * an actual runtime value has no extra or unsafe fields.
 */
export function validateCreateProjectRecordInput(
  raw: unknown,
): ProjectRecordValidationResult<NormalizedCreateProjectRecordInput> {
  const collector = new IssueCollector();

  if (!isPlainObject(raw)) {
    collector.add("UNSAFE_VALUE", "Input must be a plain object.");
    return { valid: false, errors: collector.issues };
  }
  const unsafeKey = hasUnsafeOwnKey(raw);
  if (unsafeKey) {
    collector.add("UNSAFE_VALUE", `${unsafeKey} is not allowed as an object key.`, unsafeKey);
    return { valid: false, errors: collector.issues };
  }
  rejectUnknownKeys(raw, CREATE_INPUT_KEYS, collector, "");

  const input = raw as Partial<CreateProjectRecordInput>;

  if (typeof input.type !== "string" || !SUPPORTED_PROJECT_TYPES.has(input.type as ProjectType)) {
    collector.add("UNSUPPORTED_PROJECT_TYPE", `Project type must be one of: ${[...SUPPORTED_PROJECT_TYPES].join(", ")}.`, "type");
  }

  if (!isNonEmptyTrimmedString(input.name)) {
    collector.add("MISSING_PROJECT_NAME", "Project name is required.", "name");
  } else if (input.name.trim().length > NAME_MAX_LENGTH) {
    collector.add("PROJECT_NAME_TOO_LONG", `Project name must be at most ${NAME_MAX_LENGTH} characters.`, "name");
  }

  if (input.description !== undefined) {
    if (typeof input.description !== "string") {
      collector.add("DESCRIPTION_TOO_LONG", "Description must be a string.", "description");
    } else if (input.description.length > DESCRIPTION_MAX_LENGTH) {
      collector.add("DESCRIPTION_TOO_LONG", `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters.`, "description");
    }
  }

  const repository = validateRepositoryBinding(input.repository, collector, "repository");
  const enabledEvidenceSourceKinds = validateEvidenceSourceKinds(
    input.enabledEvidenceSourceKinds,
    collector,
    "enabledEvidenceSourceKinds",
  );

  if (collector.hasIssues) {
    return { valid: false, errors: collector.issues };
  }

  const normalized: NormalizedCreateProjectRecordInput = {
    type: input.type as ProjectType,
    name: (input.name as string).trim(),
    enabledEvidenceSourceKinds: enabledEvidenceSourceKinds ?? [],
  };
  if (input.description !== undefined) {
    const trimmed = (input.description as string).trim();
    if (trimmed.length > 0) normalized.description = trimmed;
  }
  if (repository) normalized.repository = repository;

  return { valid: true, value: normalized };
}

const UPDATE_INPUT_KEYS = new Set([
  "expectedVersion",
  "name",
  "description",
  "repository",
  "enabledEvidenceSourceKinds",
]);

/** Validates and normalizes update input. `id`, `ownerId`, and `type` are deliberately not accepted here -- they are immutable and are not part of the update shape at all, not merely ignored if present. */
export function validateUpdateProjectRecordInput(
  raw: unknown,
): ProjectRecordValidationResult<NormalizedProjectRecordConfigChanges> {
  const collector = new IssueCollector();

  if (!isPlainObject(raw)) {
    collector.add("UNSAFE_VALUE", "Input must be a plain object.");
    return { valid: false, errors: collector.issues };
  }
  const unsafeKey = hasUnsafeOwnKey(raw);
  if (unsafeKey) {
    collector.add("UNSAFE_VALUE", `${unsafeKey} is not allowed as an object key.`, unsafeKey);
    return { valid: false, errors: collector.issues };
  }
  rejectUnknownKeys(raw, UPDATE_INPUT_KEYS, collector, "");

  const input = raw as Partial<UpdateProjectRecordInput>;

  if (typeof input.expectedVersion !== "number" || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    collector.add("INVALID_EXPECTED_VERSION", "expectedVersion must be a positive integer.", "expectedVersion");
  }

  if (input.name !== undefined) {
    if (!isNonEmptyTrimmedString(input.name)) {
      collector.add("MISSING_PROJECT_NAME", "Project name cannot be blank.", "name");
    } else if (input.name.trim().length > NAME_MAX_LENGTH) {
      collector.add("PROJECT_NAME_TOO_LONG", `Project name must be at most ${NAME_MAX_LENGTH} characters.`, "name");
    }
  }

  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string" || input.description.length > DESCRIPTION_MAX_LENGTH) {
      collector.add("DESCRIPTION_TOO_LONG", `Description must be a string of at most ${DESCRIPTION_MAX_LENGTH} characters.`, "description");
    }
  }

  let repository: ProjectRecordRepositoryBinding | undefined;
  const clearingRepository = input.repository === null;
  if (input.repository !== undefined && input.repository !== null) {
    repository = validateRepositoryBinding(input.repository, collector, "repository");
  }

  const enabledEvidenceSourceKinds = validateEvidenceSourceKinds(
    input.enabledEvidenceSourceKinds,
    collector,
    "enabledEvidenceSourceKinds",
  );

  const hasAnyEditableField =
    input.name !== undefined ||
    input.description !== undefined ||
    input.repository !== undefined ||
    input.enabledEvidenceSourceKinds !== undefined;
  if (!hasAnyEditableField) {
    collector.add("NO_EDITABLE_FIELDS", "At least one editable field must be supplied.");
  }

  if (collector.hasIssues) {
    return { valid: false, errors: collector.issues };
  }

  const normalized: NormalizedProjectRecordConfigChanges = {
    expectedVersion: input.expectedVersion as number,
  };
  if (input.name !== undefined) normalized.name = (input.name as string).trim();
  if (input.description !== undefined) {
    normalized.description = input.description === null ? null : (input.description as string).trim() || null;
  }
  if (clearingRepository) {
    normalized.repository = null;
  } else if (repository) {
    normalized.repository = repository;
  }
  if (enabledEvidenceSourceKinds !== undefined) normalized.enabledEvidenceSourceKinds = enabledEvidenceSourceKinds;

  return { valid: true, value: normalized };
}
