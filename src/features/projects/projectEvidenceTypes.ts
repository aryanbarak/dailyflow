// SmartFlow Slice 4B -- ProjectEvidence Foundation.
//
// ProjectEvidence is a traceable, provenance-carrying observation, not a
// conclusion (docs/architecture/project-domain.md section 6,
// docs/architecture/project-evidence-acquisition.md sections 6-13, which
// this module implements directly). This module defines the domain shape,
// validation contract, and typed errors only -- it performs no source
// reading, no adapter invocation, and no interpretation.
//
// ProjectEvidence is immutable once created
// (project-evidence-acquisition.md section 14): there is no update
// operation anywhere in this domain, its validation, its repository, or its
// service. A correction or newer observation is always a new record,
// optionally linked to the one it replaces via `supersedesId` -- the old
// record is never mutated.

import type { ProjectSourceKind } from "./projectContextTypes";

/**
 * Canonical, non-ordinal classification
 * (project-evidence-acquisition.md section 12). Deliberately excludes
 * `derived` (belongs to ProjectContext, never to ProjectEvidence),
 * `llm_inferred`/`generated` (LLM output is not evidence under current
 * architecture), `accepted_execution_result` (named as a future,
 * not-yet-approved pathway), and `rejected` (not a persisted evidence
 * state -- a candidate that fails validation is never persisted at all).
 */
export const PROJECT_EVIDENCE_CLASSIFICATIONS = [
  "observed",
  "explicit_user_statement",
  "imported",
  "verified_provider_observation",
  "canonical_document_observation",
] as const;

export type ProjectEvidenceClassification = (typeof PROJECT_EVIDENCE_CLASSIFICATIONS)[number];

/**
 * The durable, immutable, project-scoped observation
 * (project-evidence-acquisition.md section 6). Every field here has a
 * current, stated architectural need -- no ProjectContext-derived field
 * (objective/milestone/decision/capability/risk), no approval, no execution
 * intent, no runtime result, no provider credential, and no mutable
 * freshness or trust-tier field is present.
 */
export interface ProjectEvidence {
  id: string;
  projectId: string;
  ownerId: string;
  sourceKind: ProjectSourceKind;
  classification: ProjectEvidenceClassification;
  title: string;
  reference: string;
  /** When the source was observed to contain this -- injected by the caller (a future adapter), never read from the system clock by this module. */
  collectedAt: string;
  adapterIdentity: string;
  adapterVersion: string;
  verificationMethod: string;
  sourceRevision?: string;
  /** A probability-like estimate in [0, 1], present only where the origin makes it meaningful. Never a substitute for provenance. */
  confidence?: number;
  /** Explicit representation of what is not known or not verified about this item. */
  uncertainty?: string;
  notes?: string;
  /** References the ProjectEvidence record this one explicitly replaces. The referenced record is never mutated. */
  supersedesId?: string;
  /** Opaque identifier for the acquisition attempt that produced this candidate, where the caller supplies one. Not a foreign key -- acquisition attempts are not persisted by this slice. */
  acquisitionAttemptId?: string;
  createdAt: string;
}

/**
 * Input for creating a ProjectEvidence record. `id` and `ownerId` are
 * deliberately absent: identity is server-generated and ownership is
 * resolved from the trusted authentication boundary, never accepted from
 * caller-supplied input.
 */
export interface CreateProjectEvidenceInput {
  projectId: string;
  sourceKind: ProjectSourceKind;
  classification: ProjectEvidenceClassification;
  title: string;
  reference: string;
  collectedAt: string;
  adapterIdentity: string;
  adapterVersion: string;
  verificationMethod: string;
  sourceRevision?: string;
  confidence?: number;
  uncertainty?: string;
  notes?: string;
  supersedesId?: string;
  acquisitionAttemptId?: string;
}

/** A normalized, safe-to-persist create input: trimmed strings, no unknown or unsafe fields. */
export type NormalizedCreateProjectEvidenceInput = CreateProjectEvidenceInput;

export type ProjectEvidenceValidationErrorCode =
  | "UNSAFE_VALUE"
  | "UNKNOWN_FIELD"
  | "MISSING_PROJECT_ID"
  | "INVALID_PROJECT_ID"
  | "UNSUPPORTED_SOURCE_KIND"
  | "UNSUPPORTED_CLASSIFICATION"
  | "MISSING_TITLE"
  | "TITLE_TOO_LONG"
  | "MISSING_REFERENCE"
  | "REFERENCE_TOO_LONG"
  | "UNSAFE_REFERENCE"
  | "INVALID_COLLECTED_AT"
  | "MISSING_ADAPTER_IDENTITY"
  | "ADAPTER_IDENTITY_TOO_LONG"
  | "MISSING_ADAPTER_VERSION"
  | "ADAPTER_VERSION_TOO_LONG"
  | "MISSING_VERIFICATION_METHOD"
  | "VERIFICATION_METHOD_TOO_LONG"
  | "SOURCE_REVISION_TOO_LONG"
  | "INVALID_CONFIDENCE"
  | "UNCERTAINTY_TOO_LONG"
  | "NOTES_TOO_LONG"
  | "INVALID_SUPERSEDES_ID"
  | "INVALID_ACQUISITION_ATTEMPT_ID";

export interface ProjectEvidenceValidationIssue {
  code: ProjectEvidenceValidationErrorCode;
  message: string;
  path?: string;
}

export type ProjectEvidenceValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; errors: readonly ProjectEvidenceValidationIssue[] };

/**
 * Typed failures for the service/repository layer. Distinct from
 * `ProjectEvidenceValidationErrorCode`, which covers input-shape rejection
 * before any persistence is attempted.
 *
 * `NOT_FOUND` and `PROJECT_NOT_FOUND` are deliberately used both when a
 * record/project does not exist and when it exists but is owned by another
 * user -- mirroring `ProjectRecordError`'s `NOT_FOUND` convention -- so a
 * cross-user or cross-project lookup never confirms another user's data
 * exists. `SUPERSEDED_EVIDENCE_NOT_FOUND` follows the same rule: it is
 * returned identically whether the referenced id does not exist at all or
 * exists but belongs to a different owner or a different project.
 */
export type ProjectEvidenceErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_INPUT"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "SOURCE_KIND_NOT_ENABLED"
  | "SUPERSEDED_EVIDENCE_NOT_FOUND"
  | "NOT_FOUND"
  | "DUPLICATE_EVIDENCE"
  | "PERSISTENCE_FAILED";

export class ProjectEvidenceError extends Error {
  readonly code: ProjectEvidenceErrorCode;
  readonly issues?: readonly ProjectEvidenceValidationIssue[];

  constructor(code: ProjectEvidenceErrorCode, message: string, issues?: readonly ProjectEvidenceValidationIssue[]) {
    super(message);
    this.name = "ProjectEvidenceError";
    this.code = code;
    this.issues = issues;
  }
}

export interface ListProjectEvidenceOptions {
  /**
   * Defaults to false: superseded records are hidden from a plain list
   * unless explicitly requested. This is Slice-local list shaping only --
   * it does not compute "current truth" and does not resolve conflicts.
   * Whether a durable, canonical "current evidence set" concept exists is
   * an open decision (project-evidence-acquisition.md section 25), not
   * settled by this option.
   */
  includeSuperseded?: boolean;
}
