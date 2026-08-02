// SmartFlow Slice 3 -- ProjectRecord Foundation.
//
// ProjectRecord is the durable, owner-editable aggregate root for project
// identity and configuration (docs/architecture/project-domain.md section 5).
// It is deliberately separate from ProjectContext (projectContextTypes.ts):
// ProjectRecord is what the user configures; ProjectContext is what is
// derived, read-only, and rebuildable from evidence. Nothing in this module
// may absorb a ProjectContext field (current objective, milestones, accepted
// decisions, capabilities, risks, candidate actions, freshness metadata).
//
// ProjectRecord is not execution authority (project-domain.md section 3,
// section 11). It must never carry approval state, execution intent,
// execution attempt, runtime result, provider credentials, access tokens, or
// policy decisions. See docs/architecture/authority-model.md and
// docs/architecture/execution-intent.md for the boundaries this module stays
// outside of.

import type { ProjectSourceKind, ProjectType } from "./projectContextTypes";

/** Every enabled evidence-source kind must be one of these -- an unknown kind fails validation rather than being silently accepted. Mirrors ProjectSourceKind (projectContextTypes.ts) exactly: enabling a kind here only configures which future evidence categories are allowed to feed a context build, never a category ProjectContextBuilder itself would reject. */
export const PROJECT_RECORD_EVIDENCE_SOURCE_KINDS: readonly ProjectSourceKind[] = [
  "repository_document",
  "architecture_document",
  "adr",
  "roadmap_document",
  "product_direction_document",
  "project_status_document",
  "verified_repository_state",
  "verified_integration_evidence",
];

/**
 * Closed lifecycle. Deliberately not the ProjectContext milestone/objective
 * status vocabulary (project-domain.md section 4's terminology rule).
 */
export type ProjectRecordLifecycleStatus = "active" | "archived";

/** Only GitHub is implemented. The union exists so a future provider is an addition to this type, not a redesign of ProjectRecord. */
export type ProjectRecordRepositoryProvider = "github";

/**
 * Repository binding *configuration* only -- provider, owner, and repository
 * name. This is never connection status, verified repository evidence,
 * GitHub authority, execution permission, or a provider credential
 * (project-domain.md section 12's repository-binding clarifying note).
 */
export interface ProjectRecordRepositoryBinding {
  provider: ProjectRecordRepositoryProvider;
  owner: string;
  name: string;
}

/**
 * The durable, owner-editable aggregate root for one project's identity and
 * configuration. Every field here has a single owner (ProjectRecord itself)
 * and a current, stated need -- see docs/architecture/project-domain.md
 * section 5 and section 12's source-of-truth matrix.
 */
export interface ProjectRecord {
  id: string;
  ownerId: string;
  type: ProjectType;
  name: string;
  description?: string;
  status: ProjectRecordLifecycleStatus;
  repository?: ProjectRecordRepositoryBinding;
  enabledEvidenceSourceKinds: readonly ProjectSourceKind[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a ProjectRecord. `ownerId` is deliberately absent: ownership is resolved from the trusted authentication boundary by the service layer, never accepted from caller-supplied input. */
export interface CreateProjectRecordInput {
  type: ProjectType;
  name: string;
  description?: string;
  repository?: ProjectRecordRepositoryBinding;
  enabledEvidenceSourceKinds?: readonly ProjectSourceKind[];
}

/**
 * Input for updating a ProjectRecord's editable configuration.
 * `expectedVersion` is required so a stale write fails explicitly instead of
 * silently overwriting a newer one (optimistic concurrency). Identity fields
 * (`id`, `ownerId`, `type`) are not present here -- they are immutable once
 * created and cannot be requested as an update.
 */
export interface UpdateProjectRecordInput {
  expectedVersion: number;
  name?: string;
  /** `null` explicitly clears the description; `undefined` leaves it unchanged. */
  description?: string | null;
  /** `null` explicitly clears the repository binding; `undefined` leaves it unchanged. */
  repository?: ProjectRecordRepositoryBinding | null;
  enabledEvidenceSourceKinds?: readonly ProjectSourceKind[];
}

export type ProjectRecordValidationErrorCode =
  | "MISSING_PROJECT_NAME"
  | "PROJECT_NAME_TOO_LONG"
  | "UNSUPPORTED_PROJECT_TYPE"
  | "DESCRIPTION_TOO_LONG"
  | "INVALID_REPOSITORY_BINDING"
  | "UNSUPPORTED_REPOSITORY_PROVIDER"
  | "INVALID_EVIDENCE_SOURCE_KIND"
  | "DUPLICATE_EVIDENCE_SOURCE_KIND"
  | "INVALID_EXPECTED_VERSION"
  | "UNSAFE_VALUE"
  | "UNKNOWN_FIELD"
  | "NO_EDITABLE_FIELDS";

export interface ProjectRecordValidationIssue {
  code: ProjectRecordValidationErrorCode;
  message: string;
  path?: string;
}

/** A normalized, safe-to-persist create input: trimmed strings, deduplicated evidence-source kinds, no unknown or unsafe fields. */
export interface NormalizedCreateProjectRecordInput {
  type: ProjectType;
  name: string;
  description?: string;
  repository?: ProjectRecordRepositoryBinding;
  enabledEvidenceSourceKinds: readonly ProjectSourceKind[];
}

/** A normalized, safe-to-persist set of configuration changes. A field's absence here means "leave unchanged"; `null` means "explicitly clear" for the fields that support clearing. */
export interface NormalizedProjectRecordConfigChanges {
  expectedVersion: number;
  name?: string;
  description?: string | null;
  repository?: ProjectRecordRepositoryBinding | null;
  enabledEvidenceSourceKinds?: readonly ProjectSourceKind[];
}

export type ProjectRecordValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; errors: readonly ProjectRecordValidationIssue[] };

/**
 * Typed failures for the service/repository layer. Distinct from
 * `ProjectRecordValidationErrorCode`, which covers input-shape rejection
 * before any persistence is attempted.
 *
 * `NOT_FOUND` is deliberately used both when a record does not exist and
 * when it exists but is owned by another user -- mirroring the repository's
 * existing `tasksService` convention of never distinguishing the two, so a
 * cross-user lookup never confirms another user's record exists.
 */
export type ProjectRecordErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "STALE_VERSION"
  | "RECORD_ARCHIVED"
  | "DUPLICATE_REPOSITORY_BINDING"
  | "PERSISTENCE_FAILED";

export class ProjectRecordError extends Error {
  readonly code: ProjectRecordErrorCode;
  readonly issues?: readonly ProjectRecordValidationIssue[];

  constructor(code: ProjectRecordErrorCode, message: string, issues?: readonly ProjectRecordValidationIssue[]) {
    super(message);
    this.name = "ProjectRecordError";
    this.code = code;
    this.issues = issues;
  }
}

export interface ListProjectRecordsOptions {
  /** Defaults to false: archived records are hidden from a plain list unless explicitly requested. */
  includeArchived?: boolean;
}
