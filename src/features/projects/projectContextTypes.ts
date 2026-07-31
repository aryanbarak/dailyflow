// SmartFlow Slice 2A -- Software Project Context Foundation.
//
// This module is a read-only domain foundation. It represents project state;
// it does not execute, approve, or own execution authority. See
// docs/architecture/representative-engine.md ("a recommendation is not
// execution intent") and docs/architecture/execution-intent.md for the
// canonical boundaries this module must stay outside of.
//
// Deliberately not imported here: anything from `src/features/agent/*`
// (execution intent, policy, runtime, handlers). Project Context must remain
// observational and must not become a second policy engine or a hidden
// execution channel.

export const PROJECT_CONTEXT_VERSION = "project-context-v1" as const;

/**
 * Only Software Project is implemented in this slice. Learning Project and
 * Personal Project are named in docs/product/product-direction-v1.md as
 * future project types; adding them later is a matter of widening this
 * union, not redesigning it.
 */
export type ProjectType = "software_project";

// ---------------------------------------------------------------------------
// ProjectSource
// ---------------------------------------------------------------------------

/**
 * The kinds of evidence a ProjectSource may point to. Non-exhaustive by
 * design (docs/product direction may introduce more), but every kind used at
 * runtime must be one of these -- an unknown kind fails validation rather
 * than being silently accepted.
 */
export type ProjectSourceKind =
  | "repository_document"
  | "architecture_document"
  | "adr"
  | "roadmap_document"
  | "product_direction_document"
  | "project_status_document"
  | "verified_repository_state"
  | "verified_integration_evidence";

/**
 * A traceable reference to authoritative evidence. `reference` is
 * intentionally constrained (see projectContextBuilder's validation) rather
 * than accepted as an arbitrary trusted filesystem path: document kinds must
 * be a relative repository path, verified-state kinds must describe the
 * verified fact rather than a filesystem location.
 */
export interface ProjectSource {
  id: string;
  kind: ProjectSourceKind;
  title: string;
  reference: string;
  retrievedAt?: string;
  notes?: string;
}

export type ProjectSourceInput = ProjectSource;

// ---------------------------------------------------------------------------
// ProjectObjective
// ---------------------------------------------------------------------------

export type ProjectObjectiveStatus = "active" | "achieved" | "abandoned" | "superseded";

export interface ProjectObjective {
  id: string;
  summary: string;
  status: ProjectObjectiveStatus;
  sourceIds: readonly string[];
  since?: string;
}

export type ProjectObjectiveInput = ProjectObjective;

// ---------------------------------------------------------------------------
// ProjectMilestone
// ---------------------------------------------------------------------------

export type ProjectMilestoneStatus = "planned" | "active" | "completed" | "deferred" | "blocked";

export interface ProjectMilestone {
  id: string;
  title: string;
  status: ProjectMilestoneStatus;
  sourceIds: readonly string[];
  /** Optional explicit ordering hint used for deterministic display order. */
  order?: number;
  completedAt?: string;
}

export type ProjectMilestoneInput = ProjectMilestone;

// ---------------------------------------------------------------------------
// ProjectDecision
// ---------------------------------------------------------------------------

export type ProjectDecisionStatus = "accepted" | "proposed" | "superseded" | "rejected";

/**
 * An accepted or proposed project/architectural decision. A
 * CandidateProjectAction is a structurally different type and can never
 * satisfy this shape -- a suggestion cannot become a decision by relabeling.
 */
export interface ProjectDecision {
  id: string;
  title: string;
  status: ProjectDecisionStatus;
  sourceIds: readonly string[];
  decidedAt?: string;
  /** id of another ProjectDecision this one supersedes, if any. */
  supersedesId?: string;
}

export type ProjectDecisionInput = ProjectDecision;

// ---------------------------------------------------------------------------
// ProjectCapability
// ---------------------------------------------------------------------------

export type ProjectCapabilityStatus =
  | "implemented"
  | "partially_implemented"
  | "planned"
  | "deferred"
  | "unsupported";

/**
 * Deliberately no `isImplemented: boolean`. A boolean cannot represent
 * "partially implemented" or "planned" without lying by omission, which is
 * exactly what this slice must prevent (planned functionality must never
 * present as currently available).
 */
export interface ProjectCapability {
  id: string;
  title: string;
  status: ProjectCapabilityStatus;
  sourceIds: readonly string[];
  notes?: string;
}

export type ProjectCapabilityInput = ProjectCapability;

// ---------------------------------------------------------------------------
// ProjectRisk
// ---------------------------------------------------------------------------

export type ProjectRiskSeverity = "low" | "medium" | "high";

/** Every risk must be evidence-backed: sourceIds is required and non-empty. */
export interface ProjectRisk {
  id: string;
  summary: string;
  severity: ProjectRiskSeverity;
  sourceIds: readonly string[];
  notes?: string;
}

export type ProjectRiskInput = ProjectRisk;

// ---------------------------------------------------------------------------
// CandidateProjectAction
// ---------------------------------------------------------------------------

/**
 * A recommendation only. `kind` and `authority` are redundant-by-design
 * discriminant fields: they make it structurally obvious (not just by
 * convention) that this is not a ProjectDecision, cannot authorize
 * execution, and cannot be approved. Nothing in this module ever promotes a
 * CandidateProjectAction into a ProjectDecision or an execution intent.
 */
export interface CandidateProjectAction {
  id: string;
  kind: "candidate_action";
  authority: "non_authoritative";
  summary: string;
  rationale?: string;
  sourceIds: readonly string[];
  relatedCapabilityId?: string;
  relatedRiskId?: string;
}

export type CandidateProjectActionInput = CandidateProjectAction;

// ---------------------------------------------------------------------------
// SoftwareProject
// ---------------------------------------------------------------------------

export type ProjectRepositoryConnectionStatus = "connected" | "not_connected";

/**
 * One source of project context among several -- see SoftwareProject's own
 * doc comment. This binding describes connection identity/status only; it
 * never carries credentials, tokens, or a provider client.
 */
export interface ProjectRepositoryBinding {
  provider: "github";
  owner: string;
  name: string;
  connectionStatus: ProjectRepositoryConnectionStatus;
}

/**
 * A first-class SmartFlow project. A repository is one possible evidence
 * source for a project, not the project itself -- `repository` is optional
 * and, even when present, is only one of the sources referenced by the
 * project's objectives, milestones, decisions, capabilities, and risks.
 */
export interface SoftwareProject {
  id: string;
  type: ProjectType;
  name: string;
  repository?: ProjectRepositoryBinding;
}

export type SoftwareProjectInput = SoftwareProject;

// ---------------------------------------------------------------------------
// ProjectContext (normalized aggregate)
// ---------------------------------------------------------------------------

export interface ProjectContextMetadata {
  builderVersion: typeof PROJECT_CONTEXT_VERSION;
  /** Injected clock value. The builder never reads the system clock itself. */
  generatedAt: string;
}

/**
 * The deterministic, normalized, read-only representation of a Software
 * Project. Every field here is derived from validated ProjectContextInput by
 * projectContextBuilder -- nothing here is authoritative on its own, and an
 * LLM never produces this shape directly.
 */
export interface ProjectContext {
  contextVersion: typeof PROJECT_CONTEXT_VERSION;
  project: SoftwareProject;
  /** The single active objective, if any. Never guessed from array order. */
  currentObjective?: ProjectObjective;
  objectives: readonly ProjectObjective[];
  /** The single active milestone, if any. */
  activeMilestone?: ProjectMilestone;
  completedMilestones: readonly ProjectMilestone[];
  /** Planned, deferred, and blocked milestones (anything not active/completed). */
  plannedOrDeferredMilestones: readonly ProjectMilestone[];
  acceptedDecisions: readonly ProjectDecision[];
  implementedCapabilities: readonly ProjectCapability[];
  plannedOrDeferredCapabilities: readonly ProjectCapability[];
  risks: readonly ProjectRisk[];
  sources: readonly ProjectSource[];
  candidateActions: readonly CandidateProjectAction[];
  metadata: ProjectContextMetadata;
}

// ---------------------------------------------------------------------------
// Builder input and validation result
// ---------------------------------------------------------------------------

export interface ProjectContextInput {
  project: SoftwareProjectInput;
  objectives: readonly ProjectObjectiveInput[];
  milestones: readonly ProjectMilestoneInput[];
  decisions: readonly ProjectDecisionInput[];
  capabilities: readonly ProjectCapabilityInput[];
  risks: readonly ProjectRiskInput[];
  sources: readonly ProjectSourceInput[];
  candidateActions: readonly CandidateProjectActionInput[];
  /** Injected clock value (ISO 8601). The builder never calls Date.now(). */
  generatedAt: string;
}

export type ProjectContextValidationErrorCode =
  | "MISSING_PROJECT_IDENTITY"
  | "UNSUPPORTED_PROJECT_TYPE"
  | "UNSAFE_VALUE"
  | "MALFORMED_ENTITY"
  | "DUPLICATE_SOURCE_ID"
  | "DUPLICATE_OBJECTIVE_ID"
  | "DUPLICATE_MILESTONE_ID"
  | "DUPLICATE_DECISION_ID"
  | "DUPLICATE_CAPABILITY_ID"
  | "DUPLICATE_RISK_ID"
  | "DUPLICATE_CANDIDATE_ACTION_ID"
  | "MULTIPLE_ACTIVE_OBJECTIVES"
  | "MULTIPLE_ACTIVE_MILESTONES"
  | "INVALID_SOURCE_KIND"
  | "INVALID_SOURCE_REFERENCE"
  | "INVALID_OBJECTIVE_STATUS"
  | "INVALID_MILESTONE_STATUS"
  | "INVALID_DECISION_STATUS"
  | "INVALID_CAPABILITY_STATUS"
  | "INVALID_RISK_SEVERITY"
  | "MISSING_SOURCE_REFERENCE"
  | "UNKNOWN_SOURCE_ID"
  | "UNKNOWN_RELATED_REFERENCE"
  | "DECISION_SUPERSEDES_UNKNOWN"
  | "MALFORMED_CANDIDATE_ACTION"
  | "MISSING_GENERATED_AT";

export interface ProjectContextValidationIssue {
  code: ProjectContextValidationErrorCode;
  message: string;
  path?: string;
}

export type ProjectContextBuildResult =
  | { valid: true; context: ProjectContext }
  | { valid: false; errors: readonly ProjectContextValidationIssue[] };
