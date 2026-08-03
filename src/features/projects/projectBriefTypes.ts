// SmartFlow -- Project Brief Foundation.
//
// The first deterministic, evidence-backed ProjectBrief: a typed summary
// derived only from explicit, supported facts extracted from an already
// persisted EvidenceSnapshot's canonical documents. Every field here is
// either directly traceable to one or more evidence items (via
// `BriefProvenance`) or explicitly empty/unknown -- never inferred, never
// summarized from arbitrary prose, and never AI-generated. This is a
// deterministic extraction and assembly result, not a understanding or
// reasoning result (docs/architecture/project-domain.md section 6's
// "validated state over inferred state" principle applied one layer up from
// ProjectContext).

import type { ProjectSourceKind } from "./projectContextTypes";

export const PROJECT_BRIEF_VERSION = "project-brief-v1" as const;

/** Bounds enforced by `validateProjectBrief` -- see projectBriefAssembler.ts. */
export const MAX_BRIEF_ITEM_TEXT_LENGTH = 800;
export const MAX_BRIEF_ITEMS_PER_FIELD = 200;

/**
 * Traces one extracted fact back to the exact evidence item and, where
 * practical, the exact document location it came from. Every
 * `ProjectBriefTextItem` and every populated `ProjectBriefSingleValueField`
 * candidate carries one of these -- no brief content exists without
 * provenance.
 */
export interface BriefProvenance {
  readonly sourceEvidenceId: string;
  readonly sourceReference: string;
  readonly sourceKind: ProjectSourceKind;
  readonly sectionHeading?: string;
  readonly lineOffset?: number;
}

/** One extracted, evidence-backed piece of text -- a completed milestone, an open decision, a risk, a next action, or a limitation. */
export interface ProjectBriefTextItem {
  readonly text: string;
  readonly provenance: BriefProvenance;
  /**
   * Present only when this item was found to directly contradict another
   * source's claim about the same named item (e.g. the same milestone name
   * marked complete by one source and listed as deferred by another). Both
   * statements are always still present as separate `ProjectBriefTextItem`s
   * -- this field only cross-references the conflicting one(s); it never
   * removes or overrides either statement.
   */
  readonly conflictedWith?: readonly BriefProvenance[];
}

/**
 * A single-valued fact (`currentPhase`, `currentFocus`) that may be:
 * unknown (no supported source declared it explicitly); known (exactly one
 * value, traceable to one source -- or multiple sources that agree
 * verbatim); or conflicted (two or more supported sources explicitly
 * disagree). "Conflicted" is never silently resolved to one value --
 * project-domain.md section 15's array-order/latest-wins prohibition
 * applies here exactly as it does to ProjectContext.
 */
export type ProjectBriefSingleValueField<T> =
  | { readonly status: "unknown" }
  | { readonly status: "known"; readonly value: T; readonly provenance: BriefProvenance }
  | {
      readonly status: "conflicted";
      readonly candidates: readonly { readonly value: T; readonly provenance: BriefProvenance }[];
    };

export type ProjectBriefExtractionWarningCode =
  | "UNSUPPORTED_SOURCE_KIND"
  | "UNSUPPORTED_DOCUMENT_SHAPE"
  | "MISSING_EXPECTED_SECTION"
  | "DUPLICATE_HEADING"
  | "MALFORMED_ADR_METADATA"
  | "ADR_NOT_ACCEPTED"
  | "ADR_SUPERSEDED"
  | "ITEM_TEXT_TOO_LONG"
  | "TOO_MANY_ITEMS"
  | "EXTRACTOR_FAILED"
  | "CONFLICTING_CANONICAL_STATEMENT";

/** A typed, non-fatal issue produced while extracting or assembling a brief. Warnings never cause data loss to be silent -- every item skipped or every conflict found has a corresponding warning naming it. */
export interface ProjectBriefExtractionWarning {
  readonly code: ProjectBriefExtractionWarningCode;
  readonly message: string;
  readonly sourceEvidenceId?: string;
  readonly sourceReference?: string;
  readonly sectionHeading?: string;
}

/**
 * The assembled, evidence-backed brief. Field-by-field capability notes:
 *
 * - `acceptedDecisions` is not part of the task's minimum field list, but is
 *   needed to hold what ADR extraction explicitly names as an extractable
 *   fact ("accepted decisions") without conflating it with `openDecisions`
 *   (open/deferred/unresolved items only -- see the "Open Decisions and
 *   Risks" extraction rule, which forbids treating non-goals or limitations
 *   as open decisions).
 * - `explicitNextActions` intentionally does not use the term
 *   "recommended" -- these are exactly, and only, statements literally
 *   labeled `"Next action:"` in a supported source (PROJECT_STATUS.md's
 *   Next Sprint section, or an accepted ADR's own Consequences section).
 *   Section membership alone (e.g. "this bullet is under Consequences")
 *   never qualifies a statement as an action -- only the exact per-item
 *   label does. Nothing here is ranked, generated, or produced by any
 *   reasoning component.
 * - `decisionConsequences` holds every bullet under an accepted,
 *   non-superseded ADR's own "Consequences" section verbatim, regardless of
 *   whether any individual bullet is phrased as an action -- a consequence
 *   is not automatically a next action (some are scope/boundary statements,
 *   not action directives); only a bullet additionally carrying the
 *   `"Next action:"` label also appears in `explicitNextActions`.
 * - `limitations`, `technicalDebt`, `nonGoals`, `deferredItems`, and
 *   `outOfScope` are kept as five distinct fields, not merged, because the
 *   source documents do not state that these five concepts are
 *   equivalent: a deliberate scope exclusion ("non-goal") is not the same
 *   claim as an unresolved deficiency ("technical debt"), and neither is
 *   the same claim as a roadmap capability that has simply not been
 *   scheduled yet ("deferred"). Each field is populated only from the one
 *   heading name that literally denotes it -- see each extractor's own
 *   heading allowlist. `limitations` specifically requires an explicit
 *   "Limitations"/"Known Limitations" heading, which no currently-committed
 *   canonical document uses yet (see PROJECT_STATUS.md); it is a real,
 *   tested capability that is honestly dormant in practice today, not a
 *   silent no-op.
 */
export interface ProjectBrief {
  readonly briefVersion: typeof PROJECT_BRIEF_VERSION;
  readonly project: { readonly id: string; readonly name: string };
  readonly generatedAt: string;
  readonly snapshotHash: string;
  readonly evidenceIds: readonly string[];
  readonly currentPhase: ProjectBriefSingleValueField<string>;
  readonly currentFocus: ProjectBriefSingleValueField<string>;
  readonly completedMilestones: readonly ProjectBriefTextItem[];
  readonly openDecisions: readonly ProjectBriefTextItem[];
  readonly acceptedDecisions: readonly ProjectBriefTextItem[];
  readonly knownRisks: readonly ProjectBriefTextItem[];
  readonly explicitNextActions: readonly ProjectBriefTextItem[];
  readonly decisionConsequences: readonly ProjectBriefTextItem[];
  readonly limitations: readonly ProjectBriefTextItem[];
  readonly technicalDebt: readonly ProjectBriefTextItem[];
  readonly nonGoals: readonly ProjectBriefTextItem[];
  readonly deferredItems: readonly ProjectBriefTextItem[];
  readonly outOfScope: readonly ProjectBriefTextItem[];
  readonly extractionWarnings: readonly ProjectBriefExtractionWarning[];
  readonly sourceReferences: readonly BriefProvenance[];
}

export type ProjectBriefValidationErrorCode =
  | "TEXT_TOO_LONG"
  | "TOO_MANY_ITEMS"
  | "EMPTY_TEXT"
  | "MISSING_PROVENANCE"
  | "DUPLICATE_SOURCE_REFERENCE"
  | "NOT_JSON_SAFE"
  | "NO_SUPPORTED_CONTENT";

export interface ProjectBriefValidationIssue {
  readonly code: ProjectBriefValidationErrorCode;
  readonly message: string;
  readonly field?: string;
}

export type ProjectBriefBuildResult =
  | { readonly valid: true; readonly brief: ProjectBrief }
  | { readonly valid: false; readonly errors: readonly ProjectBriefValidationIssue[] };
