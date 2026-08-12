// SmartFlow -- Personal Memory Layer (ADR-0010).
//
// PersonalMemoryRecord is a per-fact, LLM-derived or user-declared candidate
// value about the signed-in user -- never evidence, never execution
// authority at any status, and never scoped to a project (contrast
// InferredProjectContextField, which this module's shape deliberately
// mirrors one dimension over). See
// docs/decisions/adr/ADR-0010-personal-memory-layer.md for the full data
// model and authority-semantics decision this module implements.

export const PERSONAL_MEMORY_RECORD_KINDS = [
  "preference",
  "goal",
  "working_pattern",
  "commitment",
  "personal_fact",
  "skill",
] as const;
export type PersonalMemoryRecordKind = typeof PERSONAL_MEMORY_RECORD_KINDS[number];

/** Closed three-value scale, not a free float -- ADR-0010 Decision section 1, citing ADR-0009 directly. */
export const PERSONAL_MEMORY_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;
export type PersonalMemoryConfidence = typeof PERSONAL_MEMORY_CONFIDENCE_VALUES[number];

export const PERSONAL_MEMORY_STATUS_VALUES = [
  "proposed",
  "user_confirmed",
  "user_corrected",
  "user_rejected",
  "superseded",
] as const;
export type PersonalMemoryStatus = typeof PERSONAL_MEMORY_STATUS_VALUES[number];

/**
 * Task 18, B3: 'superseded' is now REACHABLE (previously "unreachable in
 * v1" per ADR-0010's own Implementation Notes) -- confirm_personal_memory_record_update
 * is the sole write path that ever sets it, and only on an explicit user
 * Confirm of an update proposal (never automatically). See
 * 20260813000000_personal_memory_supersession.sql.
 */

export const PERSONAL_MEMORY_SOURCE_VALUES = ["model", "user"] as const;
export type PersonalMemorySource = typeof PERSONAL_MEMORY_SOURCE_VALUES[number];

/**
 * ADR-0010 section 2.b's three provenance source kinds, plus 'document'
 * (task 16, Document-Sourced Memory slice 1). `explicit_user_statement`
 * is part of the data model for forward compatibility, but no write path in
 * this implementation populates it -- its capture surface is out of scope
 * for this task (ADR-0010 section 2.b). For 'document', sourceReferenceIds
 * point at document_chunks.id (per-chunk precision), never documents.id.
 */
export const PERSONAL_MEMORY_PROVENANCE_SOURCE_KINDS = ["chat_turn", "briefing", "explicit_user_statement", "document"] as const;
export type PersonalMemoryProvenanceSourceKind = typeof PERSONAL_MEMORY_PROVENANCE_SOURCE_KINDS[number];

/**
 * Task 16 Phase-B amendment: one entry per cited document_chunks row that
 * has since been deleted (Worker re-extraction or a document hard-delete),
 * written by the snapshot_document_chunk_provenance database trigger
 * (20260811010000_personal_memory_document_provenance.sql) immediately
 * before the chunk disappears. The UI source line reads the live
 * document_chunks join first and falls back to this snapshot only for a
 * ref id the join no longer finds.
 */
export interface PersonalMemoryProvenanceSnapshotEntry {
  readonly chunkId: string;
  readonly fileName: string;
  readonly sectionLabel: string;
  /** Bounded to <=200 chars by the trigger that writes it. */
  readonly contentExcerpt: string;
}

// ---------------------------------------------------------------------------
// Per-kind content shapes -- every kind shares `summary` as its primary
// field (unlike the project layer's objective/risk "summary" vs.
// milestone/decision "title" split): every PersonalMemoryRecord kind is a
// fact-like statement about the person, not a named artifact, so one
// consistent primary field name is the accurate shape, not a simplification
// that loses information.
// ---------------------------------------------------------------------------

export interface PersonalPreferenceContent {
  readonly summary: string;
  readonly strength?: "strong" | "moderate" | "mild";
}

export interface PersonalGoalContent {
  readonly summary: string;
  readonly timeframe?: "short_term" | "long_term";
}

export interface PersonalWorkingPatternContent {
  readonly summary: string;
  readonly frequency?: "daily" | "weekly" | "occasional";
}

export interface PersonalCommitmentContent {
  readonly summary: string;
  readonly status: "active" | "completed" | "abandoned";
}

export interface PersonalFactContent {
  readonly summary: string;
  readonly category?: "identity" | "work_status" | "general";
}

export interface PersonalSkillContent {
  readonly summary: string;
  readonly level?: "beginner" | "intermediate" | "advanced";
}

export type PersonalMemoryContentFor<K extends PersonalMemoryRecordKind> = K extends "preference"
  ? PersonalPreferenceContent
  : K extends "goal"
    ? PersonalGoalContent
    : K extends "working_pattern"
      ? PersonalWorkingPatternContent
      : K extends "commitment"
        ? PersonalCommitmentContent
        : K extends "personal_fact"
          ? PersonalFactContent
          : PersonalSkillContent;

export type PersonalMemoryContent =
  | PersonalPreferenceContent
  | PersonalGoalContent
  | PersonalWorkingPatternContent
  | PersonalCommitmentContent
  | PersonalFactContent
  | PersonalSkillContent;

// ---------------------------------------------------------------------------
// Persisted aggregate
// ---------------------------------------------------------------------------

export interface PersonalMemoryProvenance {
  readonly sourceKind: PersonalMemoryProvenanceSourceKind;
  /** Non-empty by construction -- both this type and the database reject an empty array. Reference-only: ids into agent_chat_messages or agent_briefings, never a copy of the raw source text. */
  readonly sourceReferenceIds: readonly string[];
}

export interface PersonalMemoryRecord {
  readonly id: string;
  readonly ownerId: string;
  /** Absent (undefined) for source="user" rows -- a user correction is not itself an extraction run. */
  readonly runId?: string;
  readonly kind: PersonalMemoryRecordKind;
  readonly content: PersonalMemoryContent;
  readonly provenance: PersonalMemoryProvenance;
  /** Task 16 Phase-B amendment: present only for a 'document'-sourced record whose cited chunk(s) have since been deleted. See PersonalMemoryProvenanceSnapshotEntry. */
  readonly provenanceSnapshot?: readonly PersonalMemoryProvenanceSnapshotEntry[];
  readonly modelIdentity: string;
  readonly derivationVersion: string;
  readonly confidence: PersonalMemoryConfidence;
  readonly status: PersonalMemoryStatus;
  readonly source: PersonalMemorySource;
  /**
   * Set either by resolve_personal_memory_record's 'correct' branch (a
   * content correction of THIS record) or, since task 18, by
   * confirm_personal_memory_record_update (this record superseded a
   * DIFFERENT existing record via a confirmed update proposal) -- both
   * mean the identical thing to a reader: "the record this one replaced."
   * See personalMemoryRecordPresentation.ts's groupVisiblePersonalMemoryRecords
   * for how the UI's "previous version" affordance uses this uniformly for
   * both origins.
   */
  readonly supersedesId?: string;
  /** Task 18, B1: a propose-time overlap-detection SUGGESTION (set by create_personal_memory_record) that this record might be an update to the referenced one. Never itself means anything happened -- only presentational, until a user explicitly confirms it via confirmUpdate. */
  readonly possibleUpdateOfId?: string;
  /** Task 18, B3: present only when status === "superseded" -- the record that superseded this one, if it still exists (ON DELETE SET NULL -- may be absent even for a superseded record, see superseded_by_id's own migration comment). */
  readonly supersededById?: string;
  /** Task 18, B3: present only when status === "superseded" -- WHEN, permanently (never nulled by any delete, unlike supersededById). */
  readonly supersededAt?: string;
  readonly contentFingerprint: string;
  readonly createdAt: string;
}

export interface PersonalMemoryExtractionRun {
  readonly id: string;
  readonly ownerId: string;
  readonly modelIdentity: string;
  readonly derivationVersion: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly promptTokenCount?: number;
  readonly responseTokenCount?: number;
  readonly candidateCount: number;
  readonly acceptedCount: number;
  readonly droppedCount: number;
  readonly outcome?: "completed" | "failed";
  readonly failureReason?: string;
}

// ---------------------------------------------------------------------------
// Create input (model-authored candidate, persisted via
// create_personal_memory_record)
// ---------------------------------------------------------------------------

export interface CreatePersonalMemoryRecordInput {
  readonly runId: string;
  readonly kind: PersonalMemoryRecordKind;
  readonly content: PersonalMemoryContent;
  readonly provenance: PersonalMemoryProvenance;
  readonly modelIdentity: string;
  readonly derivationVersion: string;
  readonly confidence: PersonalMemoryConfidence;
}

export type CreatePersonalMemoryRecordOutcome = "created" | "duplicate_suppressed";

export interface CreatePersonalMemoryRecordResult {
  readonly outcome: CreatePersonalMemoryRecordOutcome;
  readonly record: PersonalMemoryRecord;
}

export type ResolvePersonalMemoryRecordAction = "confirm" | "correct" | "reject";

export interface ResolvePersonalMemoryRecordInput {
  readonly recordId: string;
  readonly action: ResolvePersonalMemoryRecordAction;
  /** Required only when action === "correct". */
  readonly correctedContent?: PersonalMemoryContent;
}

export type ResolvePersonalMemoryRecordOutcome = "user_confirmed" | "user_corrected" | "user_rejected";

export interface ResolvePersonalMemoryRecordResult {
  readonly outcome: ResolvePersonalMemoryRecordOutcome;
  readonly record: PersonalMemoryRecord;
}

export interface DeletePersonalMemoryRecordResult {
  readonly outcome: "deleted";
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Confirm-as-update (task 18, B2/B3) -- the sole path for confirming a
// still-proposed candidate as an update to a DIFFERENT existing record.
// Distinct from ResolvePersonalMemoryRecordInput's "confirm" action, which
// only ever operates on the one record being resolved -- this atomically
// touches TWO records (see confirm_personal_memory_record_update).
// ---------------------------------------------------------------------------

export interface ConfirmPersonalMemoryRecordUpdateInput {
  readonly candidateRecordId: string;
  readonly supersededRecordId: string;
}

export interface ConfirmPersonalMemoryRecordUpdateResult {
  readonly outcome: "update_confirmed";
  readonly candidate: PersonalMemoryRecord;
  readonly superseded: PersonalMemoryRecord;
}

export type PersonalMemoryRecordErrorCode =
  | "UNAUTHENTICATED"
  | "RUN_NOT_FOUND"
  | "SOURCE_REFERENCE_NOT_FOUND"
  | "UNSUPPORTED_PROVENANCE_SOURCE_KIND"
  | "RECORD_NOT_FOUND"
  | "RECORD_NOT_PROPOSED"
  | "SUPERSEDED_RECORD_NOT_FOUND"
  | "RECORD_ALREADY_SUPERSEDED"
  | "KIND_MISMATCH"
  | "INVALID_SUPERSESSION_PAIR"
  | "INVALID_INPUT"
  | "PERSISTENCE_FAILED";

export interface PersonalMemoryValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export class PersonalMemoryRecordError extends Error {
  constructor(
    readonly code: PersonalMemoryRecordErrorCode,
    message: string,
    readonly issues?: readonly PersonalMemoryValidationIssue[],
  ) {
    super(message);
    this.name = "PersonalMemoryRecordError";
  }
}

// ---------------------------------------------------------------------------
// Create-run input
// ---------------------------------------------------------------------------

export interface CreatePersonalMemoryExtractionRunInput {
  readonly modelIdentity: string;
  readonly derivationVersion: string;
  readonly startedAt: string;
}

export interface CompletePersonalMemoryExtractionRunInput {
  readonly runId: string;
  readonly completedAt: string;
  readonly promptTokenCount?: number;
  readonly responseTokenCount?: number;
  readonly candidateCount: number;
  readonly acceptedCount: number;
  readonly droppedCount: number;
  readonly outcome: "completed" | "failed";
  readonly failureReason?: string;
}
