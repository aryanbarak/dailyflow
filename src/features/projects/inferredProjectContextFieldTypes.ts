// SmartFlow -- Inferred Project Context Layer (ADR-0009).
//
// InferredProjectContextField is a per-field, LLM-derived candidate value
// for one of ProjectContext's named fields (objective, milestone, decision,
// risk, capability, candidate_action) -- never evidence (project-domain.md
// section 6 forbids LLM output from entering ProjectEvidence), never
// ProjectContext itself, and never execution authority at any status. See
// docs/decisions/adr/ADR-0009-inferred-project-context-layer.md for the
// full data model and authority-semantics decision this module implements.

export const INFERRED_CONTEXT_FIELD_KINDS = [
  "objective",
  "milestone",
  "decision",
  "risk",
  "capability",
  "candidate_action",
] as const;
export type InferredContextFieldKind = typeof INFERRED_CONTEXT_FIELD_KINDS[number];

/** Closed three-value scale, not a free float -- ADR-0009 Decision section 1. */
export const INFERRED_FIELD_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;
export type InferredFieldConfidence = typeof INFERRED_FIELD_CONFIDENCE_VALUES[number];

export const INFERRED_FIELD_STATUS_VALUES = [
  "proposed",
  "user_confirmed",
  "user_corrected",
  "user_rejected",
  "superseded",
] as const;
export type InferredFieldStatus = typeof INFERRED_FIELD_STATUS_VALUES[number];

export const INFERRED_FIELD_SOURCE_VALUES = ["model", "user"] as const;
export type InferredFieldSource = typeof INFERRED_FIELD_SOURCE_VALUES[number];

// ---------------------------------------------------------------------------
// Per-kind content shapes -- deliberately a narrow subset of the matching
// ProjectContextTypes entity: never `id` (server-generated on the mapped
// entity, not carried here) and never `sourceIds` (that comes from this
// field's own `sourceEvidenceIds`, not from the content payload) -- content
// holds only the semantic fields a model could plausibly propose.
// ---------------------------------------------------------------------------

export interface InferredObjectiveContent {
  readonly summary: string;
  readonly status: "active" | "achieved" | "abandoned" | "superseded";
  readonly since?: string;
}

export interface InferredMilestoneContent {
  readonly title: string;
  readonly status: "planned" | "active" | "completed" | "deferred" | "blocked";
  readonly order?: number;
  readonly completedAt?: string;
}

export interface InferredDecisionContent {
  readonly title: string;
  readonly status: "accepted" | "proposed" | "superseded" | "rejected";
  readonly decidedAt?: string;
}

export interface InferredRiskContent {
  readonly summary: string;
  readonly severity: "low" | "medium" | "high";
  readonly notes?: string;
}

export interface InferredCapabilityContent {
  readonly title: string;
  readonly status: "implemented" | "partially_implemented" | "planned" | "deferred" | "unsupported";
  readonly notes?: string;
}

export interface InferredCandidateActionContent {
  readonly summary: string;
  readonly rationale?: string;
}

export type InferredFieldContentFor<K extends InferredContextFieldKind> = K extends "objective"
  ? InferredObjectiveContent
  : K extends "milestone"
    ? InferredMilestoneContent
    : K extends "decision"
      ? InferredDecisionContent
      : K extends "risk"
        ? InferredRiskContent
        : K extends "capability"
          ? InferredCapabilityContent
          : InferredCandidateActionContent;

export type InferredFieldContent =
  | InferredObjectiveContent
  | InferredMilestoneContent
  | InferredDecisionContent
  | InferredRiskContent
  | InferredCapabilityContent
  | InferredCandidateActionContent;

// ---------------------------------------------------------------------------
// Persisted aggregate
// ---------------------------------------------------------------------------

export interface InferredProjectContextField {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string;
  /** Absent (undefined) for source="user" rows -- a user correction is not itself a derivation run. */
  readonly runId?: string;
  readonly kind: InferredContextFieldKind;
  readonly content: InferredFieldContent;
  /** Non-empty by construction -- both this type and the database reject an empty array. */
  readonly sourceEvidenceIds: readonly string[];
  readonly modelIdentity: string;
  readonly derivationVersion: string;
  readonly confidence: InferredFieldConfidence;
  readonly status: InferredFieldStatus;
  readonly source: InferredFieldSource;
  readonly supersedesId?: string;
  readonly contentFingerprint: string;
  readonly createdAt: string;
}

export interface InferredContextDerivationRun {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string;
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
// create_inferred_context_field)
// ---------------------------------------------------------------------------

export interface CreateInferredContextFieldInput {
  readonly projectId: string;
  readonly runId: string;
  readonly kind: InferredContextFieldKind;
  readonly content: InferredFieldContent;
  readonly sourceEvidenceIds: readonly string[];
  readonly modelIdentity: string;
  readonly derivationVersion: string;
  readonly confidence: InferredFieldConfidence;
}

export type CreateInferredContextFieldOutcome = "created" | "duplicate_suppressed";

export interface CreateInferredContextFieldResult {
  readonly outcome: CreateInferredContextFieldOutcome;
  readonly field: InferredProjectContextField;
}

export type ResolveInferredContextFieldAction = "confirm" | "correct" | "reject";

export interface ResolveInferredContextFieldInput {
  readonly fieldId: string;
  readonly action: ResolveInferredContextFieldAction;
  /** Required only when action === "correct". */
  readonly correctedContent?: InferredFieldContent;
}

export type ResolveInferredContextFieldOutcome = "user_confirmed" | "user_corrected" | "user_rejected";

export interface ResolveInferredContextFieldResult {
  readonly outcome: ResolveInferredContextFieldOutcome;
  readonly field: InferredProjectContextField;
}

export type InferredContextFieldErrorCode =
  | "UNAUTHENTICATED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "RUN_NOT_FOUND"
  | "SOURCE_EVIDENCE_NOT_FOUND"
  | "FIELD_NOT_FOUND"
  | "FIELD_NOT_PROPOSED"
  | "INVALID_INPUT"
  | "PERSISTENCE_FAILED";

export interface InferredContextFieldValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export class InferredContextFieldError extends Error {
  constructor(
    readonly code: InferredContextFieldErrorCode,
    message: string,
    readonly issues?: readonly InferredContextFieldValidationIssue[],
  ) {
    super(message);
    this.name = "InferredContextFieldError";
  }
}

// ---------------------------------------------------------------------------
// Create-run input
// ---------------------------------------------------------------------------

export interface CreateInferredContextDerivationRunInput {
  readonly projectId: string;
  readonly modelIdentity: string;
  readonly derivationVersion: string;
  readonly startedAt: string;
}

export interface CompleteInferredContextDerivationRunInput {
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
