// SmartFlow Slice 2A -- Software Project Context Foundation.
//
// Deterministic builder: validated ProjectContextInput -> normalized
// ProjectContext. This module never calls an LLM, never reads browser
// storage, never executes a tool, and never mutates its input. See the file
// header in projectContextTypes.ts for the authority boundaries this module
// must stay outside of.
//
// Pipeline: validate input (read-only against caller-owned data) -> clone
// accepted structured values -> normalize (sort/bucket) -> assemble context
// -> deep-freeze owned output. Cloning happens only after validation
// confirms the input is well-formed, and only the clone is ever frozen --
// caller-owned objects and arrays are never touched, let alone frozen.

import {
  PROJECT_CONTEXT_VERSION,
  type CandidateProjectAction,
  type InferredElementProvenance,
  type ProjectCapability,
  type ProjectContext,
  type ProjectContextBuildResult,
  type ProjectContextInput,
  type ProjectContextPrecedenceConflict,
  type ProjectContextValidationErrorCode,
  type ProjectContextValidationIssue,
  type ProjectDecision,
  type ProjectMilestone,
  type ProjectObjective,
  type ProjectRisk,
  type ProjectSource,
  type SoftwareProject,
} from "./projectContextTypes";

const VALID_INFERRED_STATE_CATEGORIES = new Set(["user_declared", "inferred_unconfirmed"]);
const VALID_INFERRED_CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);

const VALID_PRECEDENCE_CONFLICT_KINDS = new Set([
  "objective",
  "milestone",
  "decision",
  "capability",
  "risk",
  "candidate_action",
]);
const VALID_PRECEDENCE_TIERS = new Set(["evidence_extracted", "user_declared", "inferred_unconfirmed"]);
const VALID_PRECEDENCE_REASONS = new Set(["higher_tier_precedence", "same_tier_conflict"]);

const VALID_SOURCE_KINDS = new Set([
  "repository_document",
  "architecture_document",
  "adr",
  "roadmap_document",
  "product_direction_document",
  "project_status_document",
  "verified_repository_state",
  "verified_integration_evidence",
]);

const VALID_OBJECTIVE_STATUSES = new Set(["active", "achieved", "abandoned", "superseded"]);
const VALID_MILESTONE_STATUSES = new Set(["planned", "active", "completed", "deferred", "blocked"]);
const VALID_DECISION_STATUSES = new Set(["accepted", "proposed", "superseded", "rejected"]);
const VALID_CAPABILITY_STATUSES = new Set([
  "implemented",
  "partially_implemented",
  "planned",
  "deferred",
  "unsupported",
]);
const VALID_RISK_SEVERITIES = new Set(["low", "medium", "high"]);

const DOCUMENT_EXTENSION_PATTERN = /\.(md|json)$/;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/;
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
/** Built via fromCharCode rather than a literal escape so the source
 * text never has to contain an actual embedded NUL character. */
const NULL_BYTE_CHARACTER = String.fromCharCode(0);

function containsNullByte(value: string): boolean {
  return value.includes(NULL_BYTE_CHARACTER);
}

/**
 * Explicit segment-based validation for a document-kind ProjectSource
 * reference -- deliberately not a single regex, since a single regex is
 * exactly what let a `../`-traversal string through before (a leading
 * alnum-check does not stop `..` segments appearing later in the string).
 *
 * Policy: this reference is a plain relative-path label. It is never
 * decoded, normalized, or resolved against the filesystem in this slice.
 * Percent-encoded sequences (e.g. `%2e%2e`) are rejected outright rather
 * than decoded and re-checked -- decoding would require taking on
 * platform/encoding-specific normalization behavior this slice has no need
 * for, and rejecting unconditionally is strictly safer than attempting to
 * normalize.
 */
function isSafeRepositoryDocumentReference(reference: string): boolean {
  if (reference.length === 0) return false;
  if (containsNullByte(reference)) return false;
  if (reference.includes("%")) return false;
  if (reference.includes("\\")) return false;
  if (reference.startsWith("/")) return false;
  if (WINDOWS_DRIVE_PATTERN.test(reference)) return false;
  if (!DOCUMENT_EXTENSION_PATTERN.test(reference)) return false;

  const segments = reference.split("/");
  for (const segment of segments) {
    if (segment.length === 0) return false;
    if (segment === "." || segment === "..") return false;
    if (!SAFE_PATH_SEGMENT_PATTERN.test(segment)) return false;
  }
  return true;
}

/**
 * Verified-evidence references are a classification label describing what
 * was verified (e.g. "verified:github.repositories.list production
 * runtime"), not cryptographic or otherwise machine-checked provenance --
 * this pattern only constrains the label's shape, it does not itself prove
 * the underlying claim.
 */
const SAFE_VERIFIED_REFERENCE = /^verified:[A-Za-z0-9][A-Za-z0-9._\- :/]*$/;

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Keys a CandidateProjectAction must never carry -- smuggling any of these is an attempt to acquire authority a recommendation must not have. */
const FORBIDDEN_CANDIDATE_ACTION_KEYS = new Set([
  "toolId",
  "approved",
  "approvedAt",
  "executed",
  "executionId",
  "decidedAt",
]);

function compareValidationIssues(a: ProjectContextValidationIssue, b: ProjectContextValidationIssue): number {
  const pathA = a.path ?? "";
  const pathB = b.path ?? "";
  if (pathA !== pathB) return pathA < pathB ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

class ValidationCollector {
  readonly errors: ProjectContextValidationIssue[] = [];

  add(code: ProjectContextValidationErrorCode, message: string, path?: string) {
    this.errors.push(path ? { code, message, path } : { code, message });
  }

  get hasErrors() {
    return this.errors.length > 0;
  }

  /** Sorted by (path, code, message) so an invalid result is deterministic regardless of input collection order. */
  sortedErrors(): readonly ProjectContextValidationIssue[] {
    return [...this.errors].sort(compareValidationIssues);
  }
}

/**
 * Own enumerable property descriptors of a plain object, without ever
 * reading a property's value through normal access (`obj[key]` or
 * `Object.entries`/`Object.values`) -- both of those invoke getters
 * immediately, including hostile ones that throw. Reading descriptors via
 * `Object.getOwnPropertyDescriptors` is inert: it never calls a getter or
 * setter, so a caller can inspect *shape* (data vs. accessor) before
 * deciding whether it is safe to read a value at all.
 */
function getEnumerableOwnDescriptors(value: object): Array<[string, PropertyDescriptor]> {
  return Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([, descriptor]) => descriptor.enumerable);
}

/** True for a getter/setter (accessor) property descriptor, as opposed to a plain data property. */
function isAccessorDescriptor(descriptor: PropertyDescriptor): boolean {
  return "get" in descriptor || "set" in descriptor;
}

/**
 * Defensively walks arbitrary input to reject functions, symbols,
 * non-finite numbers, cyclic references, prototype-pollution keys, and
 * accessor (getter/setter) properties -- the same class of unsafe values
 * the Slice 1 execution-intent canonicalizer guards against, reimplemented
 * locally here so this module has no import dependency on
 * `src/features/agent/*`.
 *
 * Accessor properties are rejected by inspecting descriptors, never by
 * reading the property first: a getter that throws, has side effects, or
 * returns a different value on each read must never be invoked during
 * validation, cloning, normalization, or assembly.
 */
function scanForUnsafeValues(
  value: unknown,
  path: string,
  collector: ValidationCollector,
  seen: WeakSet<object>,
): void {
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
        collector.add("UNSAFE_VALUE", `${key} is an accessor property (getter/setter) and is not allowed.`, `${path}.${key}`);
        continue;
      }
      scanForUnsafeValues(descriptor.value, `${path}.${key}`, collector, seen);
    }
    seen.delete(value as object);
    return;
  }
}

/**
 * Produces a value that shares no mutable object/array reference with
 * `value`. Only ever called after `scanForUnsafeValues` has already
 * confirmed the whole input tree is JSON-safe (plain objects/arrays/finite
 * primitives, no cycles, no accessor properties), so this function does not
 * re-validate that -- it only clones it, so the tree handed to `deepFreeze`
 * can never be a caller-owned object or array.
 *
 * Still reads objects through property descriptors rather than direct
 * access, and still skips (never invokes) any accessor property it finds --
 * defense in depth, in case this is ever reached with data that bypassed
 * `scanForUnsafeValues`, rather than relying solely on that earlier gate.
 */
function deepCloneAccepted<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  let cloned: unknown;
  if (Array.isArray(value)) {
    cloned = value.map((entry) => deepCloneAccepted(entry, seen));
  } else {
    const entries: Record<string, unknown> = {};
    for (const [key, descriptor] of getEnumerableOwnDescriptors(value as object)) {
      if (isAccessorDescriptor(descriptor)) continue;
      entries[key] = deepCloneAccepted(descriptor.value, seen);
    }
    cloned = entries;
  }
  seen.delete(value as object);
  return cloned as T;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainEntity(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeMalformedType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * Filters a declared entity collection down to entries that are at least a
 * plain object, recording a typed, index-addressed MALFORMED_ENTITY error
 * for anything else (null, undefined, a primitive, or an array) instead of
 * letting downstream field access (`.id`, `.status`, ...) throw. Malformed
 * entries are dropped from the sanitized result but never silently --
 * every dropped entry has a corresponding collected error.
 */
function sanitizeEntities<T>(items: readonly T[], label: string, collector: ValidationCollector): T[] {
  const sanitized: T[] = [];
  items.forEach((item, index) => {
    if (!isPlainEntity(item)) {
      collector.add(
        "MALFORMED_ENTITY",
        `${label}[${index}] must be a plain object, received ${describeMalformedType(item)}.`,
        `${label}[${index}]`,
      );
      return;
    }
    sanitized.push(item);
  });
  return sanitized;
}

/**
 * Guards against the collection itself not being an array (e.g. a string or
 * object supplied where `milestones` should be an array) -- the companion
 * case to sanitizeEntities' per-entry guard, so an untrusted collection can
 * never reach `.forEach`/`.map` and throw.
 */
function ensureArrayCollection<T>(
  value: readonly T[] | null | undefined,
  label: string,
  collector: ValidationCollector,
): readonly T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    collector.add("MALFORMED_ENTITY", `${label} must be an array, received ${describeMalformedType(value)}.`, label);
    return [];
  }
  return value;
}

function compareById(a: { id: string }, b: { id: string }): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort(compareById);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}

function checkDuplicateIds(
  items: readonly { id: string }[],
  code: ProjectContextValidationErrorCode,
  label: string,
  collector: ValidationCollector,
) {
  const seen = new Set<string>();
  for (const item of items) {
    if (!isNonEmptyString(item.id)) {
      collector.add(code, `${label} is missing a non-empty id.`);
      continue;
    }
    if (seen.has(item.id)) {
      collector.add(code, `Duplicate ${label} id: ${item.id}.`, item.id);
    }
    seen.add(item.id);
  }
}

function checkSourceReferences(
  sourceIds: readonly string[] | undefined,
  knownSourceIds: ReadonlySet<string>,
  path: string,
  collector: ValidationCollector,
  required: boolean,
) {
  if (!sourceIds || sourceIds.length === 0) {
    if (required) {
      collector.add("MISSING_SOURCE_REFERENCE", `${path} requires at least one source reference.`, path);
    }
    return;
  }
  for (const sourceId of sourceIds) {
    if (!knownSourceIds.has(sourceId)) {
      collector.add("UNKNOWN_SOURCE_ID", `${path} references unknown source id: ${sourceId}.`, path);
    }
  }
}

/**
 * ADR-0009: light shape validation of an entity's optional
 * `inferredProvenance` marker. By the time this reaches
 * ProjectContextBuilder, the marker is already-trusted internal data built
 * by the mapping layer (contextRebuildInferredFieldsInput.ts), not raw
 * model output -- deterministic per-kind content validation already
 * happened upstream (inferredProjectContextFieldValidation.ts) before
 * anything was persisted. This is defense-in-depth only, matching this
 * module's existing "validate everything at every boundary" convention,
 * never a second full re-validation of the inferred field itself.
 */
function checkInferredProvenance(provenance: unknown, path: string, collector: ValidationCollector) {
  if (provenance === undefined) return;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    collector.add("INVALID_INFERRED_PROVENANCE", `${path}.inferredProvenance must be a plain object if present.`, path);
    return;
  }
  const record = provenance as Partial<InferredElementProvenance>;
  if (typeof record.stateCategory !== "string" || !VALID_INFERRED_STATE_CATEGORIES.has(record.stateCategory)) {
    collector.add("INVALID_INFERRED_PROVENANCE", `${path}.inferredProvenance has an unsupported stateCategory.`, path);
  }
  if (!isNonEmptyString(record.inferredFieldId)) {
    collector.add("INVALID_INFERRED_PROVENANCE", `${path}.inferredProvenance is missing inferredFieldId.`, path);
  }
  if (typeof record.confidence !== "string" || !VALID_INFERRED_CONFIDENCE_VALUES.has(record.confidence)) {
    collector.add("INVALID_INFERRED_PROVENANCE", `${path}.inferredProvenance has an unsupported confidence.`, path);
  }
  if (!isNonEmptyString(record.modelIdentity)) {
    collector.add("INVALID_INFERRED_PROVENANCE", `${path}.inferredProvenance is missing modelIdentity.`, path);
  }
}

/**
 * ADR-0009 Decision section 2 / review finding F1. Light shape validation
 * only, matching checkInferredProvenance's own defense-in-depth posture:
 * every ProjectContextPrecedenceConflict reaching this function was already
 * computed by contextPrecedenceResolver.ts (trusted internal data, never
 * raw model output) -- this is a second check at the boundary, never a
 * re-derivation of the precedence decision itself.
 */
function checkPrecedenceConflictEntries(
  entries: unknown,
  path: string,
  collector: ValidationCollector,
): void {
  if (!Array.isArray(entries)) {
    collector.add("INVALID_PRECEDENCE_CONFLICT", `${path} must be an array.`, path);
    return;
  }
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      collector.add("INVALID_PRECEDENCE_CONFLICT", `${path} contains a non-object entry.`, path);
      continue;
    }
    const record = entry as { id?: unknown; tier?: unknown };
    if (!isNonEmptyString(record.id)) {
      collector.add("INVALID_PRECEDENCE_CONFLICT", `${path} entry is missing id.`, path);
    }
    if (typeof record.tier !== "string" || !VALID_PRECEDENCE_TIERS.has(record.tier)) {
      collector.add("INVALID_PRECEDENCE_CONFLICT", `${path} entry has an unsupported tier.`, path);
    }
  }
}

function checkPrecedenceConflicts(conflicts: unknown, collector: ValidationCollector): void {
  if (!Array.isArray(conflicts)) {
    collector.add("INVALID_PRECEDENCE_CONFLICT", "precedenceConflicts must be an array.", "precedenceConflicts");
    return;
  }
  for (let index = 0; index < conflicts.length; index += 1) {
    const conflict = conflicts[index];
    const path = `precedenceConflicts[${index}]`;
    if (!conflict || typeof conflict !== "object" || Array.isArray(conflict)) {
      collector.add("INVALID_PRECEDENCE_CONFLICT", `${path} must be a plain object.`, path);
      continue;
    }
    if (typeof conflict.kind !== "string" || !VALID_PRECEDENCE_CONFLICT_KINDS.has(conflict.kind)) {
      collector.add("INVALID_PRECEDENCE_CONFLICT", `${path} has an unsupported kind.`, path);
    }
    if (!isNonEmptyString(conflict.slotKey)) {
      collector.add("INVALID_PRECEDENCE_CONFLICT", `${path} is missing slotKey.`, path);
    }
    if (typeof conflict.reason !== "string" || !VALID_PRECEDENCE_REASONS.has(conflict.reason)) {
      collector.add("INVALID_PRECEDENCE_CONFLICT", `${path} has an unsupported reason.`, path);
    }
    checkPrecedenceConflictEntries(conflict.winners, `${path}.winners`, collector);
    checkPrecedenceConflictEntries(conflict.superseded, `${path}.superseded`, collector);
  }
}

function validateSources(sources: readonly ProjectSource[], collector: ValidationCollector): readonly ProjectSource[] {
  const sanitized = sanitizeEntities(sources, "sources", collector);
  checkDuplicateIds(sanitized, "DUPLICATE_SOURCE_ID", "source", collector);
  for (const source of sanitized) {
    if (!VALID_SOURCE_KINDS.has(source.kind)) {
      collector.add("INVALID_SOURCE_KIND", `Source ${source.id} has an unsupported kind: ${source.kind}.`, source.id);
      continue;
    }
    if (!isNonEmptyString(source.reference)) {
      collector.add("INVALID_SOURCE_REFERENCE", `Source ${source.id} is missing a reference.`, source.id);
      continue;
    }
    const isVerifiedKind = source.kind === "verified_repository_state" || source.kind === "verified_integration_evidence";
    const isSafe = isVerifiedKind
      ? SAFE_VERIFIED_REFERENCE.test(source.reference)
      : isSafeRepositoryDocumentReference(source.reference);
    if (!isSafe) {
      collector.add(
        "INVALID_SOURCE_REFERENCE",
        `Source ${source.id} reference does not match the safe ${isVerifiedKind ? "verified-evidence" : "repository-document"} pattern: ${source.reference}.`,
        source.id,
      );
    }
  }
  return sanitized;
}

function validateObjectives(
  objectives: readonly ProjectObjective[],
  knownSourceIds: ReadonlySet<string>,
  collector: ValidationCollector,
): readonly ProjectObjective[] {
  const sanitized = sanitizeEntities(objectives, "objectives", collector);
  checkDuplicateIds(sanitized, "DUPLICATE_OBJECTIVE_ID", "objective", collector);
  let activeCount = 0;
  for (const objective of sanitized) {
    if (!VALID_OBJECTIVE_STATUSES.has(objective.status)) {
      collector.add(
        "INVALID_OBJECTIVE_STATUS",
        `Objective ${objective.id} has an unsupported status: ${String(objective.status)}.`,
        objective.id,
      );
      continue;
    }
    if (objective.status === "active") activeCount += 1;
    checkSourceReferences(objective.sourceIds, knownSourceIds, `objective:${objective.id}`, collector, true);
    checkInferredProvenance(objective.inferredProvenance, `objective:${objective.id}`, collector);
  }
  if (activeCount > 1) {
    collector.add("MULTIPLE_ACTIVE_OBJECTIVES", `Expected at most one active objective, found ${activeCount}.`);
  }
  return sanitized;
}

function validateMilestones(
  milestones: readonly ProjectMilestone[],
  knownSourceIds: ReadonlySet<string>,
  collector: ValidationCollector,
): readonly ProjectMilestone[] {
  const sanitized = sanitizeEntities(milestones, "milestones", collector);
  checkDuplicateIds(sanitized, "DUPLICATE_MILESTONE_ID", "milestone", collector);
  let activeCount = 0;
  for (const milestone of sanitized) {
    if (!VALID_MILESTONE_STATUSES.has(milestone.status)) {
      collector.add(
        "INVALID_MILESTONE_STATUS",
        `Milestone ${milestone.id} has an unsupported status: ${String(milestone.status)}.`,
        milestone.id,
      );
      continue;
    }
    if (milestone.status === "active") activeCount += 1;
    checkSourceReferences(milestone.sourceIds, knownSourceIds, `milestone:${milestone.id}`, collector, true);
    checkInferredProvenance(milestone.inferredProvenance, `milestone:${milestone.id}`, collector);
  }
  if (activeCount > 1) {
    collector.add("MULTIPLE_ACTIVE_MILESTONES", `Expected at most one active milestone, found ${activeCount}.`);
  }
  return sanitized;
}

function validateDecisions(
  decisions: readonly ProjectDecision[],
  knownSourceIds: ReadonlySet<string>,
  collector: ValidationCollector,
): readonly ProjectDecision[] {
  const sanitized = sanitizeEntities(decisions, "decisions", collector);
  checkDuplicateIds(sanitized, "DUPLICATE_DECISION_ID", "decision", collector);
  const knownDecisionIds = new Set(sanitized.map((decision) => decision.id));
  for (const decision of sanitized) {
    if (typeof decision.status !== "string" || !VALID_DECISION_STATUSES.has(decision.status)) {
      collector.add(
        "INVALID_DECISION_STATUS",
        `Decision ${decision.id} has an unsupported or ambiguous status: ${JSON.stringify(decision.status)}.`,
        decision.id,
      );
      continue;
    }
    const requiresSource = decision.status === "accepted";
    checkSourceReferences(decision.sourceIds, knownSourceIds, `decision:${decision.id}`, collector, requiresSource);
    if (decision.supersedesId && !knownDecisionIds.has(decision.supersedesId)) {
      collector.add(
        "DECISION_SUPERSEDES_UNKNOWN",
        `Decision ${decision.id} supersedes unknown decision id: ${decision.supersedesId}.`,
        decision.id,
      );
    }
    checkInferredProvenance(decision.inferredProvenance, `decision:${decision.id}`, collector);
  }
  return sanitized;
}

function validateCapabilities(
  capabilities: readonly ProjectCapability[],
  knownSourceIds: ReadonlySet<string>,
  collector: ValidationCollector,
): readonly ProjectCapability[] {
  const sanitized = sanitizeEntities(capabilities, "capabilities", collector);
  checkDuplicateIds(sanitized, "DUPLICATE_CAPABILITY_ID", "capability", collector);
  for (const capability of sanitized) {
    if (!VALID_CAPABILITY_STATUSES.has(capability.status)) {
      collector.add(
        "INVALID_CAPABILITY_STATUS",
        `Capability ${capability.id} has an unsupported status: ${String(capability.status)}.`,
        capability.id,
      );
      continue;
    }
    const requiresSource = capability.status === "implemented" || capability.status === "partially_implemented";
    checkSourceReferences(capability.sourceIds, knownSourceIds, `capability:${capability.id}`, collector, requiresSource);
    checkInferredProvenance(capability.inferredProvenance, `capability:${capability.id}`, collector);
  }
  return sanitized;
}

function validateRisks(
  risks: readonly ProjectRisk[],
  knownSourceIds: ReadonlySet<string>,
  collector: ValidationCollector,
): readonly ProjectRisk[] {
  const sanitized = sanitizeEntities(risks, "risks", collector);
  checkDuplicateIds(sanitized, "DUPLICATE_RISK_ID", "risk", collector);
  for (const risk of sanitized) {
    if (!VALID_RISK_SEVERITIES.has(risk.severity)) {
      collector.add("INVALID_RISK_SEVERITY", `Risk ${risk.id} has an unsupported severity: ${String(risk.severity)}.`, risk.id);
      continue;
    }
    checkSourceReferences(risk.sourceIds, knownSourceIds, `risk:${risk.id}`, collector, true);
    checkInferredProvenance(risk.inferredProvenance, `risk:${risk.id}`, collector);
  }
  return sanitized;
}

function validateCandidateActions(
  candidateActions: readonly CandidateProjectAction[],
  knownSourceIds: ReadonlySet<string>,
  knownCapabilityIds: ReadonlySet<string>,
  knownRiskIds: ReadonlySet<string>,
  collector: ValidationCollector,
): readonly CandidateProjectAction[] {
  const sanitized = sanitizeEntities(candidateActions, "candidateActions", collector);
  checkDuplicateIds(sanitized, "DUPLICATE_CANDIDATE_ACTION_ID", "candidate action", collector);
  for (const action of sanitized) {
    const raw = action as unknown as Record<string, unknown>;
    for (const forbiddenKey of FORBIDDEN_CANDIDATE_ACTION_KEYS) {
      if (forbiddenKey in raw) {
        collector.add(
          "MALFORMED_CANDIDATE_ACTION",
          `Candidate action ${String(action.id)} carries forbidden authority-bearing field: ${forbiddenKey}.`,
          action.id,
        );
      }
    }
    if (action.kind !== "candidate_action" || action.authority !== "non_authoritative") {
      collector.add(
        "MALFORMED_CANDIDATE_ACTION",
        `Candidate action ${String(action.id)} must declare kind "candidate_action" and authority "non_authoritative".`,
        action.id,
      );
    }
    if (!isNonEmptyString(action.summary)) {
      collector.add("MALFORMED_CANDIDATE_ACTION", `Candidate action ${String(action.id)} is missing a summary.`, action.id);
    }
    checkSourceReferences(action.sourceIds, knownSourceIds, `candidateAction:${action.id}`, collector, false);
    if (action.relatedCapabilityId && !knownCapabilityIds.has(action.relatedCapabilityId)) {
      collector.add(
        "UNKNOWN_RELATED_REFERENCE",
        `Candidate action ${action.id} references unknown capability id: ${action.relatedCapabilityId}.`,
        action.id,
      );
    }
    if (action.relatedRiskId && !knownRiskIds.has(action.relatedRiskId)) {
      collector.add(
        "UNKNOWN_RELATED_REFERENCE",
        `Candidate action ${action.id} references unknown risk id: ${action.relatedRiskId}.`,
        action.id,
      );
    }
    checkInferredProvenance(action.inferredProvenance, `candidateAction:${action.id}`, collector);
  }
  return sanitized;
}

function validateProject(project: SoftwareProject, collector: ValidationCollector) {
  if (!project || !isNonEmptyString(project.id) || !isNonEmptyString(project.name)) {
    collector.add("MISSING_PROJECT_IDENTITY", "Project must have a non-empty id and name.");
    return;
  }
  if (project.type !== "software_project") {
    collector.add(
      "UNSUPPORTED_PROJECT_TYPE",
      `Unsupported project type: ${String(project.type)}. Only "software_project" is implemented in this slice.`,
    );
  }
}

/**
 * Converts validated ProjectContextInput into a normalized, immutable
 * ProjectContext. Pure and synchronous: given the same logical input
 * (including under reordered collections), it returns an equal result every
 * time. Never mutates `input` -- everything assembled into the returned,
 * deep-frozen context is a fresh clone (see `deepCloneAccepted`), never a
 * reference into `input` itself.
 */
export function buildProjectContext(input: ProjectContextInput): ProjectContextBuildResult {
  const collector = new ValidationCollector();

  if (!input || typeof input !== "object") {
    collector.add("MISSING_PROJECT_IDENTITY", "Project context input is missing.");
    return { valid: false, errors: collector.sortedErrors() };
  }

  scanForUnsafeValues(input, "input", collector, new WeakSet());
  if (collector.hasErrors) {
    return { valid: false, errors: collector.sortedErrors() };
  }

  if (!isNonEmptyString(input.generatedAt)) {
    collector.add("MISSING_GENERATED_AT", "generatedAt must be a non-empty injected timestamp.");
  }

  validateProject(input.project, collector);

  const sources = ensureArrayCollection(input.sources, "sources", collector);
  const objectives = ensureArrayCollection(input.objectives, "objectives", collector);
  const milestones = ensureArrayCollection(input.milestones, "milestones", collector);
  const decisions = ensureArrayCollection(input.decisions, "decisions", collector);
  const capabilities = ensureArrayCollection(input.capabilities, "capabilities", collector);
  const risks = ensureArrayCollection(input.risks, "risks", collector);
  const candidateActions = ensureArrayCollection(input.candidateActions, "candidateActions", collector);

  const sanitizedSources = validateSources(sources, collector);
  const knownSourceIds = new Set(sanitizedSources.map((source) => source.id));

  const sanitizedObjectives = validateObjectives(objectives, knownSourceIds, collector);
  const sanitizedMilestones = validateMilestones(milestones, knownSourceIds, collector);
  const sanitizedDecisions = validateDecisions(decisions, knownSourceIds, collector);
  const sanitizedCapabilities = validateCapabilities(capabilities, knownSourceIds, collector);
  const sanitizedRisks = validateRisks(risks, knownSourceIds, collector);

  const knownCapabilityIds = new Set(sanitizedCapabilities.map((capability) => capability.id));
  const knownRiskIds = new Set(sanitizedRisks.map((risk) => risk.id));
  const sanitizedCandidateActions = validateCandidateActions(
    candidateActions,
    knownSourceIds,
    knownCapabilityIds,
    knownRiskIds,
    collector,
  );

  const precedenceConflicts = input.precedenceConflicts ?? [];
  checkPrecedenceConflicts(precedenceConflicts, collector);

  if (collector.hasErrors) {
    return { valid: false, errors: collector.sortedErrors() };
  }

  // Everything below this point is guaranteed well-shaped (validation found
  // zero errors). Clone before assembling so the frozen output can never
  // share a reference with the caller's input.
  const clonedProject = deepCloneAccepted(input.project);
  const clonedObjectives = deepCloneAccepted(sanitizedObjectives);
  const clonedMilestones = deepCloneAccepted(sanitizedMilestones);
  const clonedDecisions = deepCloneAccepted(sanitizedDecisions);
  const clonedCapabilities = deepCloneAccepted(sanitizedCapabilities);
  const clonedRisks = deepCloneAccepted(sanitizedRisks);
  const clonedSources = deepCloneAccepted(sanitizedSources);
  const clonedCandidateActions = deepCloneAccepted(sanitizedCandidateActions);
  const clonedPrecedenceConflicts = deepCloneAccepted(precedenceConflicts);

  const sortedObjectives = sortById(clonedObjectives);
  const sortedMilestones = sortById(clonedMilestones).sort((a, b) => {
    const orderA = a.order ?? Number.POSITIVE_INFINITY;
    const orderB = b.order ?? Number.POSITIVE_INFINITY;
    return orderA - orderB;
  });
  const sortedDecisions = sortById(clonedDecisions);
  const sortedCapabilities = sortById(clonedCapabilities);
  const sortedRisks = sortById(clonedRisks);
  const sortedSources = sortById(clonedSources);
  const sortedCandidateActions = sortById(clonedCandidateActions);

  const currentObjective = sortedObjectives.find((objective) => objective.status === "active");
  const activeMilestone = sortedMilestones.find((milestone) => milestone.status === "active");
  const completedMilestones = sortedMilestones.filter((milestone) => milestone.status === "completed");
  const plannedOrDeferredMilestones = sortedMilestones.filter(
    (milestone) => milestone.status === "planned" || milestone.status === "deferred" || milestone.status === "blocked",
  );
  const acceptedDecisions = sortedDecisions.filter((decision) => decision.status === "accepted");
  const implementedCapabilities = sortedCapabilities.filter(
    (capability) => capability.status === "implemented" || capability.status === "partially_implemented",
  );
  const plannedOrDeferredCapabilities = sortedCapabilities.filter(
    (capability) => capability.status === "planned" || capability.status === "deferred" || capability.status === "unsupported",
  );

  const context: ProjectContext = {
    contextVersion: PROJECT_CONTEXT_VERSION,
    project: clonedProject,
    ...(currentObjective ? { currentObjective } : {}),
    objectives: sortedObjectives,
    ...(activeMilestone ? { activeMilestone } : {}),
    completedMilestones,
    plannedOrDeferredMilestones,
    acceptedDecisions,
    implementedCapabilities,
    plannedOrDeferredCapabilities,
    risks: sortedRisks,
    sources: sortedSources,
    candidateActions: sortedCandidateActions,
    precedenceConflicts: clonedPrecedenceConflicts,
    metadata: {
      builderVersion: PROJECT_CONTEXT_VERSION,
      generatedAt: input.generatedAt,
    },
  };

  return { valid: true, context: deepFreeze(context) };
}
