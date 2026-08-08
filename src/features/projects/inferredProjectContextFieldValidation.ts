// SmartFlow -- Inferred Project Context Layer (ADR-0009).
//
// Pure, deterministic, synchronous validation: untrusted per-kind content ->
// a shape-validated value, or a typed list of issues. No I/O, no clock read,
// no randomness. This is the single source of truth for "is this content
// correctly shaped for its kind" -- the database column only enforces
// "present and bounded" (see the migration's own comment on `content`).
//
// Plain-object descriptor scanning (the hostile-getter defense
// projectEvidenceValidation.ts applies) is deliberately not duplicated here:
// every caller of this module constructs its input from `JSON.parse` output
// (the Worker's own parsed Gemini response, or a plain literal in tests) --
// never from an arbitrary caller-supplied object that could carry a
// throwing accessor. A plain `typeof`/`in` shape check is the right amount
// of defense for this specific attack surface, not the exotic descriptor
// walk that matters for a broadly-reused validation entry point.
//
// This is the CANONICAL per-kind validator. agent/worker's own
// context-derivation-endpoint.ts cannot import this module (zero-runtime-
// dependency deployable unit) and therefore duplicates its rules in its own
// normalizeCandidate -- kept manually in sync, per that file's header
// comment. Review finding F2
// (docs/reviews/2026-08-inferred-context-layer-review.md, MAJOR #4) found
// the two had drifted (date-shaped fields were a bounded-string check on
// the Worker side instead of a parseable-timestamp check). The standing
// guard against that recurring is
// contextDerivationValidationEquivalence.test.ts, which runs the SAME
// fixture set through both this module and the Worker's normalizeCandidate
// and asserts identical accept/reject outcomes for every kind.

import {
  INFERRED_CONTEXT_FIELD_KINDS,
  INFERRED_FIELD_CONFIDENCE_VALUES,
  type InferredCandidateActionContent,
  type InferredCapabilityContent,
  type InferredContextFieldKind,
  type InferredDecisionContent,
  type InferredFieldConfidence,
  type InferredFieldContent,
  type InferredFieldContentFor,
  type InferredMilestoneContent,
  type InferredObjectiveContent,
  type InferredRiskContent,
} from "./inferredProjectContextFieldTypes";

export const MAX_INFERRED_FIELD_TEXT_LENGTH = 500;
export const MAX_SOURCE_EVIDENCE_IDS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InferredFieldValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export type InferredFieldContentValidationResult<K extends InferredContextFieldKind> =
  | { readonly valid: true; readonly value: InferredFieldContentFor<K> }
  | { readonly valid: false; readonly errors: readonly InferredFieldValidationIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function optionalBoundedString(value: unknown, maxLength: number): { present: boolean; value?: string } {
  if (value === undefined) return { present: true };
  const parsed = boundedString(value, maxLength);
  return parsed === null ? { present: false } : { present: true, value: parsed };
}

function optionalIsoTimestamp(value: unknown): { present: boolean; value?: string } {
  if (value === undefined) return { present: true };
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return { present: false };
  return { present: true, value };
}

function isKnownField(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function validateObjectiveContent(raw: Record<string, unknown>): InferredFieldContentValidationResult<"objective"> {
  const errors: InferredFieldValidationIssue[] = [];
  if (!isKnownField(raw, ["summary", "status", "since"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "objective content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_INFERRED_FIELD_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "objective content requires a non-empty, bounded summary.", field: "summary" });
  const status = boundedString(raw.status, 20);
  const validStatuses = new Set<InferredObjectiveContent["status"]>(["active", "achieved", "abandoned", "superseded"]);
  if (!status || !validStatuses.has(status as InferredObjectiveContent["status"])) {
    errors.push({ code: "INVALID_STATUS", message: "objective content has an unsupported status.", field: "status" });
  }
  const since = optionalIsoTimestamp(raw.since);
  if (!since.present) errors.push({ code: "INVALID_SINCE", message: "objective content's since must be a valid timestamp if present.", field: "since" });
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: { summary: summary as string, status: status as InferredObjectiveContent["status"], ...(since.value ? { since: since.value } : {}) },
  };
}

function validateMilestoneContent(raw: Record<string, unknown>): InferredFieldContentValidationResult<"milestone"> {
  const errors: InferredFieldValidationIssue[] = [];
  if (!isKnownField(raw, ["title", "status", "order", "completedAt"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "milestone content contains an unrecognized field." });
  }
  const title = boundedString(raw.title, MAX_INFERRED_FIELD_TEXT_LENGTH);
  if (!title) errors.push({ code: "INVALID_TITLE", message: "milestone content requires a non-empty, bounded title.", field: "title" });
  const status = boundedString(raw.status, 20);
  const validStatuses = new Set<InferredMilestoneContent["status"]>(["planned", "active", "completed", "deferred", "blocked"]);
  if (!status || !validStatuses.has(status as InferredMilestoneContent["status"])) {
    errors.push({ code: "INVALID_STATUS", message: "milestone content has an unsupported status.", field: "status" });
  }
  let order: number | undefined;
  if (raw.order !== undefined) {
    if (typeof raw.order !== "number" || !Number.isFinite(raw.order)) {
      errors.push({ code: "INVALID_ORDER", message: "milestone content's order must be a finite number if present.", field: "order" });
    } else {
      order = raw.order;
    }
  }
  const completedAt = optionalIsoTimestamp(raw.completedAt);
  if (!completedAt.present) errors.push({ code: "INVALID_COMPLETED_AT", message: "milestone content's completedAt must be a valid timestamp if present.", field: "completedAt" });
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: {
      title: title as string,
      status: status as InferredMilestoneContent["status"],
      ...(order !== undefined ? { order } : {}),
      ...(completedAt.value ? { completedAt: completedAt.value } : {}),
    },
  };
}

function validateDecisionContent(raw: Record<string, unknown>): InferredFieldContentValidationResult<"decision"> {
  const errors: InferredFieldValidationIssue[] = [];
  if (!isKnownField(raw, ["title", "status", "decidedAt"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "decision content contains an unrecognized field." });
  }
  const title = boundedString(raw.title, MAX_INFERRED_FIELD_TEXT_LENGTH);
  if (!title) errors.push({ code: "INVALID_TITLE", message: "decision content requires a non-empty, bounded title.", field: "title" });
  const status = boundedString(raw.status, 20);
  const validStatuses = new Set<InferredDecisionContent["status"]>(["accepted", "proposed", "superseded", "rejected"]);
  if (!status || !validStatuses.has(status as InferredDecisionContent["status"])) {
    errors.push({ code: "INVALID_STATUS", message: "decision content has an unsupported status.", field: "status" });
  }
  const decidedAt = optionalIsoTimestamp(raw.decidedAt);
  if (!decidedAt.present) errors.push({ code: "INVALID_DECIDED_AT", message: "decision content's decidedAt must be a valid timestamp if present.", field: "decidedAt" });
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: { title: title as string, status: status as InferredDecisionContent["status"], ...(decidedAt.value ? { decidedAt: decidedAt.value } : {}) },
  };
}

function validateRiskContent(raw: Record<string, unknown>): InferredFieldContentValidationResult<"risk"> {
  const errors: InferredFieldValidationIssue[] = [];
  if (!isKnownField(raw, ["summary", "severity", "notes"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "risk content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_INFERRED_FIELD_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "risk content requires a non-empty, bounded summary.", field: "summary" });
  const severity = boundedString(raw.severity, 10);
  const validSeverities = new Set<InferredRiskContent["severity"]>(["low", "medium", "high"]);
  if (!severity || !validSeverities.has(severity as InferredRiskContent["severity"])) {
    errors.push({ code: "INVALID_SEVERITY", message: "risk content has an unsupported severity.", field: "severity" });
  }
  const notes = optionalBoundedString(raw.notes, 1000);
  if (!notes.present) errors.push({ code: "INVALID_NOTES", message: "risk content's notes must be a bounded string if present.", field: "notes" });
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: { summary: summary as string, severity: severity as InferredRiskContent["severity"], ...(notes.value ? { notes: notes.value } : {}) },
  };
}

function validateCapabilityContent(raw: Record<string, unknown>): InferredFieldContentValidationResult<"capability"> {
  const errors: InferredFieldValidationIssue[] = [];
  if (!isKnownField(raw, ["title", "status", "notes"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "capability content contains an unrecognized field." });
  }
  const title = boundedString(raw.title, MAX_INFERRED_FIELD_TEXT_LENGTH);
  if (!title) errors.push({ code: "INVALID_TITLE", message: "capability content requires a non-empty, bounded title.", field: "title" });
  const status = boundedString(raw.status, 25);
  const validStatuses = new Set<InferredCapabilityContent["status"]>([
    "implemented",
    "partially_implemented",
    "planned",
    "deferred",
    "unsupported",
  ]);
  if (!status || !validStatuses.has(status as InferredCapabilityContent["status"])) {
    errors.push({ code: "INVALID_STATUS", message: "capability content has an unsupported status.", field: "status" });
  }
  const notes = optionalBoundedString(raw.notes, 1000);
  if (!notes.present) errors.push({ code: "INVALID_NOTES", message: "capability content's notes must be a bounded string if present.", field: "notes" });
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: { title: title as string, status: status as InferredCapabilityContent["status"], ...(notes.value ? { notes: notes.value } : {}) },
  };
}

function validateCandidateActionContent(raw: Record<string, unknown>): InferredFieldContentValidationResult<"candidate_action"> {
  const errors: InferredFieldValidationIssue[] = [];
  if (!isKnownField(raw, ["summary", "rationale"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "candidate_action content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_INFERRED_FIELD_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "candidate_action content requires a non-empty, bounded summary.", field: "summary" });
  const rationale = optionalBoundedString(raw.rationale, 1000);
  if (!rationale.present) errors.push({ code: "INVALID_RATIONALE", message: "candidate_action content's rationale must be a bounded string if present.", field: "rationale" });
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { summary: summary as string, ...(rationale.value ? { rationale: rationale.value } : {}) } };
}

/**
 * Validates raw content against exactly one kind's shape. Rejects unknown
 * fields (fails closed rather than silently dropping them) and never
 * coerces a malformed value into a best-effort shape -- ADR-0009 Decision
 * section 3: "invalid output dropped and logged, never coerced."
 */
export function validateInferredFieldContent<K extends InferredContextFieldKind>(
  kind: K,
  raw: unknown,
): InferredFieldContentValidationResult<K> {
  if (!isPlainObject(raw)) {
    return { valid: false, errors: [{ code: "MALFORMED_CONTENT", message: "Content must be a plain object." }] };
  }
  if (kind === "objective") return validateObjectiveContent(raw) as InferredFieldContentValidationResult<K>;
  if (kind === "milestone") return validateMilestoneContent(raw) as InferredFieldContentValidationResult<K>;
  if (kind === "decision") return validateDecisionContent(raw) as InferredFieldContentValidationResult<K>;
  if (kind === "risk") return validateRiskContent(raw) as InferredFieldContentValidationResult<K>;
  if (kind === "capability") return validateCapabilityContent(raw) as InferredFieldContentValidationResult<K>;
  return validateCandidateActionContent(raw) as InferredFieldContentValidationResult<K>;
}

export function isSupportedInferredContextFieldKind(value: unknown): value is InferredContextFieldKind {
  return typeof value === "string" && (INFERRED_CONTEXT_FIELD_KINDS as readonly string[]).includes(value);
}

export function isSupportedInferredFieldConfidence(value: unknown): value is InferredFieldConfidence {
  return typeof value === "string" && (INFERRED_FIELD_CONFIDENCE_VALUES as readonly string[]).includes(value);
}

export function validateSourceEvidenceIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCE_EVIDENCE_IDS) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item));
  if (ids.length !== value.length) return null;
  return ids;
}

/**
 * Canonicalizes a content object to a stable string (sorted keys, no
 * whitespace variance) before hashing -- object key insertion order is not
 * guaranteed identical across every construction path (a plain literal vs.
 * a value rebuilt from a database row), so hashing raw `JSON.stringify`
 * output directly would make the "same content" case produce different
 * fingerprints depending on incidental key order. Every value here is a
 * flat primitive (string/number), so a single-level key sort is sufficient
 * -- none of this module's content shapes ever nest an object or array.
 */
function canonicalizeContent(content: InferredFieldContent): string {
  const record = content as unknown as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of sortedKeys) canonical[key] = record[key];
  return JSON.stringify(canonical);
}

/**
 * Deterministic SHA-256 over (kind, canonicalized content) -- drives
 * ADR-0009's Q1/Q5 duplicate-suppression rule. Deliberately mirrored (not
 * imported) inside agent/worker's own context-derivation-endpoint.ts, which
 * cannot import frontend modules -- see that file's header comment for the
 * maintenance note.
 */
export async function computeInferredFieldContentFingerprint(
  kind: InferredContextFieldKind,
  content: InferredFieldContent,
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Standard SHA-256 crypto API is unavailable.");
  }
  const canonical = `${kind}::${canonicalizeContent(content)}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
