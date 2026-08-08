// SmartFlow -- Inferred Project Context Layer (ADR-0009).
//
// Pure mapping only: eligible InferredProjectContextField rows ->
// ProjectContextInput's objectives/milestones/decisions/capabilities/risks/
// candidateActions additions, each carrying an InferredElementProvenance
// marker that survives into the built ProjectContext
// (representative-engine.md section 16). Never fetches anything itself --
// contextRebuildService.ts reads the fields and calls this module, exactly
// the same division of labor as contextRebuildProjectContextInput.ts's own
// pure mapping of an EvidenceSnapshot.
//
// Eligibility: only "proposed", "user_confirmed", and "user_corrected"
// fields are mapped in -- "user_rejected" and "superseded" fields are
// excluded entirely, never included as a de-weighted or hidden entity.
// "proposed" fields are included per the Product Owner's resolution to
// ADR-0009's open question 2 (shown by default, always visibly marked),
// not filtered out pending confirmation.
//
// Precedence between MULTIPLE eligible fields of the same kind is
// deliberately NOT resolved in this module. This module's own job stops at
// mapping eligible InferredProjectContextField rows into candidate
// ProjectContext elements with a correct tier marker
// (inferredProvenance.stateCategory); it has no visibility into the
// evidence-extracted candidates contextRebuildService.ts also assembles, so
// it cannot decide precedence between tiers on its own. ADR-0009 Decision
// section 2's precedence rule (evidence-extracted facts >
// user_confirmed/corrected > unconfirmed proposed) is resolved one layer up,
// after this module runs, by contextPrecedenceResolver.ts -- see that
// module's header comment for the deterministic "same slot" definition and
// the conflict-surfacing rule (review finding F1;
// docs/architecture/notes/context-derivation-v1-design-note.md's
// "Precedence and conflict surfacing" addendum). The candidates this module
// returns are precedence-resolver input, not yet the final answer.

import type {
  CandidateProjectAction,
  ProjectCapability,
  ProjectDecision,
  ProjectMilestone,
  ProjectObjective,
  ProjectRisk,
} from "./projectContextTypes";
import type {
  InferredCandidateActionContent,
  InferredCapabilityContent,
  InferredDecisionContent,
  InferredMilestoneContent,
  InferredObjectiveContent,
  InferredProjectContextField,
  InferredRiskContent,
} from "./inferredProjectContextFieldTypes";

export interface ProjectContextInputInferredAdditions {
  readonly objectives: readonly ProjectObjective[];
  readonly milestones: readonly ProjectMilestone[];
  readonly decisions: readonly ProjectDecision[];
  readonly capabilities: readonly ProjectCapability[];
  readonly risks: readonly ProjectRisk[];
  readonly candidateActions: readonly CandidateProjectAction[];
}

const ELIGIBLE_STATUSES = new Set(["proposed", "user_confirmed", "user_corrected"]);

function isEligible(field: InferredProjectContextField): boolean {
  return ELIGIBLE_STATUSES.has(field.status);
}

/** representative-engine.md section 15: a still-proposed field is "inferred_unconfirmed"; a user_confirmed or user_corrected field is "user_declared" -- the highest trust tier available in this layer, but never execution authority. */
function stateCategoryFor(field: InferredProjectContextField): "user_declared" | "inferred_unconfirmed" {
  return field.status === "proposed" ? "inferred_unconfirmed" : "user_declared";
}

function provenanceFor(field: InferredProjectContextField) {
  return {
    stateCategory: stateCategoryFor(field),
    inferredFieldId: field.id,
    confidence: field.confidence,
    modelIdentity: field.modelIdentity,
    ...(field.runId ? { derivationRunId: field.runId } : {}),
  };
}

export function mapInferredFieldsToProjectContextInputAdditions(
  fields: readonly InferredProjectContextField[],
): ProjectContextInputInferredAdditions {
  const eligible = fields.filter(isEligible);

  const objectives: ProjectObjective[] = eligible
    .filter((field) => field.kind === "objective")
    .map((field) => {
      const content = field.content as InferredObjectiveContent;
      return {
        id: field.id,
        summary: content.summary,
        status: content.status,
        sourceIds: field.sourceEvidenceIds,
        ...(content.since ? { since: content.since } : {}),
        inferredProvenance: provenanceFor(field),
      };
    });

  const milestones: ProjectMilestone[] = eligible
    .filter((field) => field.kind === "milestone")
    .map((field) => {
      const content = field.content as InferredMilestoneContent;
      return {
        id: field.id,
        title: content.title,
        status: content.status,
        sourceIds: field.sourceEvidenceIds,
        ...(content.order !== undefined ? { order: content.order } : {}),
        ...(content.completedAt ? { completedAt: content.completedAt } : {}),
        inferredProvenance: provenanceFor(field),
      };
    });

  const decisions: ProjectDecision[] = eligible
    .filter((field) => field.kind === "decision")
    .map((field) => {
      const content = field.content as InferredDecisionContent;
      return {
        id: field.id,
        title: content.title,
        status: content.status,
        sourceIds: field.sourceEvidenceIds,
        ...(content.decidedAt ? { decidedAt: content.decidedAt } : {}),
        inferredProvenance: provenanceFor(field),
      };
    });

  const capabilities: ProjectCapability[] = eligible
    .filter((field) => field.kind === "capability")
    .map((field) => {
      const content = field.content as InferredCapabilityContent;
      return {
        id: field.id,
        title: content.title,
        status: content.status,
        sourceIds: field.sourceEvidenceIds,
        ...(content.notes ? { notes: content.notes } : {}),
        inferredProvenance: provenanceFor(field),
      };
    });

  const risks: ProjectRisk[] = eligible
    .filter((field) => field.kind === "risk")
    .map((field) => {
      const content = field.content as InferredRiskContent;
      return {
        id: field.id,
        summary: content.summary,
        severity: content.severity,
        sourceIds: field.sourceEvidenceIds,
        ...(content.notes ? { notes: content.notes } : {}),
        inferredProvenance: provenanceFor(field),
      };
    });

  const candidateActions: CandidateProjectAction[] = eligible
    .filter((field) => field.kind === "candidate_action")
    .map((field) => {
      const content = field.content as InferredCandidateActionContent;
      return {
        id: field.id,
        kind: "candidate_action" as const,
        authority: "non_authoritative" as const,
        summary: content.summary,
        sourceIds: field.sourceEvidenceIds,
        ...(content.rationale ? { rationale: content.rationale } : {}),
        inferredProvenance: provenanceFor(field),
      };
    });

  return { objectives, milestones, decisions, capabilities, risks, candidateActions };
}
