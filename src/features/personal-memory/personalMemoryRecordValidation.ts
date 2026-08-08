// SmartFlow -- Personal Memory Layer (ADR-0010).
//
// Pure, deterministic, synchronous validation: untrusted per-kind content ->
// a shape-validated value, or a typed list of issues. No I/O, no clock read,
// no randomness. This is the single source of truth for "is this content
// correctly shaped for its kind" -- the database column only enforces
// "present and bounded," never "correctly shaped," exactly as
// inferredProjectContextFieldValidation.ts already documents for the
// identical reason.
//
// This is the CANONICAL per-kind validator. agent/worker's own extraction
// route cannot import this module (zero-runtime-dependency deployable unit)
// and therefore duplicates its rules, kept manually in sync -- the same
// known maintenance cost inferredProjectContextFieldValidation.ts already
// carries, guarded there by a standing equivalence test
// (contextDerivationValidationEquivalence.test.ts). This module's own
// equivalence test is personalMemoryValidationEquivalence.test.ts.
//
// DEFENSE IN DEPTH (ADR-0010 Product Owner Resolution Q2): health,
// relationships/family, and emotional-state content is excluded from v1
// even when submitted under one of the six approved kinds. The six-kind
// CHECK constraint alone cannot prevent a model from writing sensitive text
// into an otherwise-allowed kind's `summary` field (e.g. kind="personal_fact",
// summary="has been diagnosed with..."). rejectsSensitiveContent below is a
// curated keyword/phrase heuristic, not a semantic classifier -- it reduces
// but does not eliminate the risk of sensitive content slipping through,
// and it WILL have false positives (rejecting a legitimate fact that merely
// contains a matched word). A false positive fails closed (the candidate is
// dropped and logged, never persisted) which is the correct direction to
// err in for this specific risk, consistent with ADR-0009 Decision section
// 3's "invalid output dropped and logged, never coerced." The prompt
// instructing the model not to produce this content is politeness; this
// function is the actual boundary.

import {
  PERSONAL_MEMORY_CONFIDENCE_VALUES,
  PERSONAL_MEMORY_PROVENANCE_SOURCE_KINDS,
  PERSONAL_MEMORY_RECORD_KINDS,
  type PersonalCommitmentContent,
  type PersonalFactContent,
  type PersonalGoalContent,
  type PersonalMemoryConfidence,
  type PersonalMemoryContent,
  type PersonalMemoryContentFor,
  type PersonalMemoryProvenanceSourceKind,
  type PersonalMemoryRecordKind,
  type PersonalPreferenceContent,
  type PersonalSkillContent,
  type PersonalWorkingPatternContent,
} from "./personalMemoryRecordTypes";

export const MAX_PERSONAL_MEMORY_TEXT_LENGTH = 300;
export const MAX_PROVENANCE_SOURCE_REFERENCE_IDS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Curated, case-insensitive keyword/phrase heuristic covering health,
 * relationships/family, and emotional-state content -- ADR-0010's three
 * excluded categories. Deliberately broad rather than narrow: a false
 * positive drops a candidate (safe); a false negative persists sensitive
 * content (the actual harm this exists to prevent). Kept as a flat list,
 * not a scoring model, so its coverage is auditable by reading it.
 */
const SENSITIVE_CONTENT_PATTERNS: readonly RegExp[] = [
  // Health
  /\bhealth\b/i,
  /\bmedical\b/i,
  /\bdiagnos(is|ed|es)\b/i,
  /\bdisease\b/i,
  /\bill(ness)?\b/i,
  /\btherapy\b/i,
  /\btherapist\b/i,
  /\bmedication(s)?\b/i,
  /\bprescri(ption|bed)\b/i,
  /\bdepress(ion|ed)\b/i,
  /\banxiety\b/i,
  /\bmental health\b/i,
  /\bdoctor\b/i,
  /\bhospital\b/i,
  /\bpregnan(t|cy)\b/i,
  /\bdisab(led|ility)\b/i,
  /\bchronic\b/i,
  /\bsymptom(s)?\b/i,
  /\bcheck-?up(s)?\b/i,
  /\bappointment(s)?\b/i,
  /\bdentist\b/i,
  /\bclinic\b/i,
  /\bphysician\b/i,
  /\bsurgery\b/i,
  /\bvaccin(e|ation)\b/i,
  // Relationships / family
  /\bwife\b/i,
  /\bhusband\b/i,
  /\bspouse\b/i,
  /\bpartner\b/i,
  /\bgirlfriend\b/i,
  /\bboyfriend\b/i,
  /\bfianc[ée]e?\b/i,
  /\bmarri(age|ed)\b/i,
  /\bdivorce(d)?\b/i,
  /\bchild(ren)?\b/i,
  /\bkids?\b/i,
  /\bfamily\b/i,
  /\bparent(s|ing)?\b/i,
  /\bmom\b/i,
  /\bdad\b/i,
  /\bmother\b/i,
  /\bfather\b/i,
  /\bdaughter(s)?\b/i,
  /\bson(s)?\b/i,
  /\bsibling(s)?\b/i,
  /\bbrother(s)?\b/i,
  /\bsister(s)?\b/i,
  /\bgrandparent(s)?\b/i,
  /\bgrandmother\b/i,
  /\bgrandfather\b/i,
  /\bgrandma\b/i,
  /\bgrandpa\b/i,
  /\baunt\b/i,
  /\buncle\b/i,
  /\bcousin(s)?\b/i,
  /\bniece\b/i,
  /\bnephew\b/i,
  /\bin-law\b/i,
  /\brelationship\b/i,
  // Emotional state
  /\bemotion(al|ally)?\b/i,
  /\bfeeling(s)?\b/i,
  /\bstressed?\b/i,
  /\boverwhelm(ed|ing)?\b/i,
  /\bgrief\b/i,
  /\bmood\b/i,
  /\blonely\b/i,
  /\bloneliness\b/i,
  /\bburn(ed|t)?[ -]?out\b/i,
];

export interface PersonalMemoryValidationIssueLocal {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export type PersonalMemoryContentValidationResult<K extends PersonalMemoryRecordKind> =
  | { readonly valid: true; readonly value: PersonalMemoryContentFor<K> }
  | { readonly valid: false; readonly errors: readonly PersonalMemoryValidationIssueLocal[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function isKnownField(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

/** Defense in depth (see file header) -- scans every string value in the candidate content, not only `summary`, so a sensitive phrase placed in any field is still caught. */
function containsSensitiveContent(record: Record<string, unknown>): boolean {
  return Object.values(record).some(
    (value) => typeof value === "string" && SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(value)),
  );
}

function validatePreferenceContent(raw: Record<string, unknown>): PersonalMemoryContentValidationResult<"preference"> {
  const errors: PersonalMemoryValidationIssueLocal[] = [];
  if (!isKnownField(raw, ["summary", "strength"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "preference content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_PERSONAL_MEMORY_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "preference content requires a non-empty, bounded summary.", field: "summary" });
  let strength: PersonalPreferenceContent["strength"];
  if (raw.strength !== undefined) {
    const parsed = boundedString(raw.strength, 10);
    const valid = new Set<PersonalPreferenceContent["strength"]>(["strong", "moderate", "mild"]);
    if (!parsed || !valid.has(parsed as PersonalPreferenceContent["strength"])) {
      errors.push({ code: "INVALID_STRENGTH", message: "preference content has an unsupported strength.", field: "strength" });
    } else {
      strength = parsed as PersonalPreferenceContent["strength"];
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { summary: summary as string, ...(strength ? { strength } : {}) } };
}

function validateGoalContent(raw: Record<string, unknown>): PersonalMemoryContentValidationResult<"goal"> {
  const errors: PersonalMemoryValidationIssueLocal[] = [];
  if (!isKnownField(raw, ["summary", "timeframe"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "goal content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_PERSONAL_MEMORY_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "goal content requires a non-empty, bounded summary.", field: "summary" });
  let timeframe: PersonalGoalContent["timeframe"];
  if (raw.timeframe !== undefined) {
    const parsed = boundedString(raw.timeframe, 20);
    const valid = new Set<PersonalGoalContent["timeframe"]>(["short_term", "long_term"]);
    if (!parsed || !valid.has(parsed as PersonalGoalContent["timeframe"])) {
      errors.push({ code: "INVALID_TIMEFRAME", message: "goal content has an unsupported timeframe.", field: "timeframe" });
    } else {
      timeframe = parsed as PersonalGoalContent["timeframe"];
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { summary: summary as string, ...(timeframe ? { timeframe } : {}) } };
}

function validateWorkingPatternContent(raw: Record<string, unknown>): PersonalMemoryContentValidationResult<"working_pattern"> {
  const errors: PersonalMemoryValidationIssueLocal[] = [];
  if (!isKnownField(raw, ["summary", "frequency"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "working_pattern content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_PERSONAL_MEMORY_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "working_pattern content requires a non-empty, bounded summary.", field: "summary" });
  let frequency: PersonalWorkingPatternContent["frequency"];
  if (raw.frequency !== undefined) {
    const parsed = boundedString(raw.frequency, 15);
    const valid = new Set<PersonalWorkingPatternContent["frequency"]>(["daily", "weekly", "occasional"]);
    if (!parsed || !valid.has(parsed as PersonalWorkingPatternContent["frequency"])) {
      errors.push({ code: "INVALID_FREQUENCY", message: "working_pattern content has an unsupported frequency.", field: "frequency" });
    } else {
      frequency = parsed as PersonalWorkingPatternContent["frequency"];
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { summary: summary as string, ...(frequency ? { frequency } : {}) } };
}

function validateCommitmentContent(raw: Record<string, unknown>): PersonalMemoryContentValidationResult<"commitment"> {
  const errors: PersonalMemoryValidationIssueLocal[] = [];
  if (!isKnownField(raw, ["summary", "status"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "commitment content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_PERSONAL_MEMORY_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "commitment content requires a non-empty, bounded summary.", field: "summary" });
  const status = boundedString(raw.status, 15);
  const validStatuses = new Set<PersonalCommitmentContent["status"]>(["active", "completed", "abandoned"]);
  if (!status || !validStatuses.has(status as PersonalCommitmentContent["status"])) {
    errors.push({ code: "INVALID_STATUS", message: "commitment content has an unsupported status.", field: "status" });
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { summary: summary as string, status: status as PersonalCommitmentContent["status"] } };
}

function validatePersonalFactContent(raw: Record<string, unknown>): PersonalMemoryContentValidationResult<"personal_fact"> {
  const errors: PersonalMemoryValidationIssueLocal[] = [];
  if (!isKnownField(raw, ["summary", "category"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "personal_fact content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_PERSONAL_MEMORY_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "personal_fact content requires a non-empty, bounded summary.", field: "summary" });
  let category: PersonalFactContent["category"];
  if (raw.category !== undefined) {
    const parsed = boundedString(raw.category, 15);
    const valid = new Set<PersonalFactContent["category"]>(["identity", "work_status", "general"]);
    if (!parsed || !valid.has(parsed as PersonalFactContent["category"])) {
      errors.push({ code: "INVALID_CATEGORY", message: "personal_fact content has an unsupported category.", field: "category" });
    } else {
      category = parsed as PersonalFactContent["category"];
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { summary: summary as string, ...(category ? { category } : {}) } };
}

function validateSkillContent(raw: Record<string, unknown>): PersonalMemoryContentValidationResult<"skill"> {
  const errors: PersonalMemoryValidationIssueLocal[] = [];
  if (!isKnownField(raw, ["summary", "level"])) {
    errors.push({ code: "UNKNOWN_FIELD", message: "skill content contains an unrecognized field." });
  }
  const summary = boundedString(raw.summary, MAX_PERSONAL_MEMORY_TEXT_LENGTH);
  if (!summary) errors.push({ code: "INVALID_SUMMARY", message: "skill content requires a non-empty, bounded summary.", field: "summary" });
  let level: PersonalSkillContent["level"];
  if (raw.level !== undefined) {
    const parsed = boundedString(raw.level, 15);
    const valid = new Set<PersonalSkillContent["level"]>(["beginner", "intermediate", "advanced"]);
    if (!parsed || !valid.has(parsed as PersonalSkillContent["level"])) {
      errors.push({ code: "INVALID_LEVEL", message: "skill content has an unsupported level.", field: "level" });
    } else {
      level = parsed as PersonalSkillContent["level"];
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { summary: summary as string, ...(level ? { level } : {}) } };
}

/**
 * Validates raw content against exactly one kind's shape, then applies the
 * sensitive-content defense-in-depth check (ADR-0010 Q2) regardless of
 * kind. Rejects unknown fields and never coerces a malformed value into a
 * best-effort shape -- ADR-0009 Decision section 3, cited by ADR-0010
 * section 4: "invalid output dropped and logged, never coerced."
 */
export function validatePersonalMemoryContent<K extends PersonalMemoryRecordKind>(
  kind: K,
  raw: unknown,
): PersonalMemoryContentValidationResult<K> {
  if (!isPlainObject(raw)) {
    return { valid: false, errors: [{ code: "MALFORMED_CONTENT", message: "Content must be a plain object." }] };
  }

  let result: PersonalMemoryContentValidationResult<PersonalMemoryRecordKind>;
  if (kind === "preference") result = validatePreferenceContent(raw);
  else if (kind === "goal") result = validateGoalContent(raw);
  else if (kind === "working_pattern") result = validateWorkingPatternContent(raw);
  else if (kind === "commitment") result = validateCommitmentContent(raw);
  else if (kind === "personal_fact") result = validatePersonalFactContent(raw);
  else result = validateSkillContent(raw);

  if (result.valid === false) return result as PersonalMemoryContentValidationResult<K>;

  if (containsSensitiveContent(raw)) {
    return {
      valid: false,
      errors: [{ code: "SENSITIVE_CONTENT_EXCLUDED", message: "Content matches an excluded sensitive category (health, relationships/family, or emotional state) and cannot be stored (ADR-0010 Q2)." }],
    };
  }

  return result as PersonalMemoryContentValidationResult<K>;
}

export function isSupportedPersonalMemoryRecordKind(value: unknown): value is PersonalMemoryRecordKind {
  return typeof value === "string" && (PERSONAL_MEMORY_RECORD_KINDS as readonly string[]).includes(value);
}

export function isSupportedPersonalMemoryConfidence(value: unknown): value is PersonalMemoryConfidence {
  return typeof value === "string" && (PERSONAL_MEMORY_CONFIDENCE_VALUES as readonly string[]).includes(value);
}

export function isSupportedProvenanceSourceKind(value: unknown): value is PersonalMemoryProvenanceSourceKind {
  return typeof value === "string" && (PERSONAL_MEMORY_PROVENANCE_SOURCE_KINDS as readonly string[]).includes(value);
}

export function validateProvenanceSourceReferenceIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PROVENANCE_SOURCE_REFERENCE_IDS) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item));
  if (ids.length !== value.length) return null;
  return ids;
}

/**
 * Canonicalizes a content object to a stable string (sorted keys) before
 * hashing -- identical rationale to
 * inferredProjectContextFieldValidation.ts's canonicalizeContent: every
 * value here is a flat primitive, so a single-level key sort is sufficient.
 */
function canonicalizeContent(content: PersonalMemoryContent): string {
  const record = content as unknown as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of sortedKeys) canonical[key] = record[key];
  return JSON.stringify(canonical);
}

/**
 * Deterministic SHA-256 over (kind, canonicalized content) -- drives
 * ADR-0010's Q1/Q5-derived duplicate-suppression rule (citing ADR-0009
 * directly). Deliberately mirrored (not imported) inside a future
 * agent/worker extraction route, which cannot import frontend modules.
 */
export async function computePersonalMemoryContentFingerprint(
  kind: PersonalMemoryRecordKind,
  content: PersonalMemoryContent,
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
