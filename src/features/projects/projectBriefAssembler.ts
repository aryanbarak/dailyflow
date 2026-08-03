// SmartFlow -- Project Brief Foundation.
//
// Pure assembly: an EvidenceSnapshot's items, run through the per-source-
// kind extractors, merged into one validated ProjectBrief. Owns exactly
// three cross-cutting concerns none of the individual extractors can see
// on their own: deterministic ordering (never source array order), single-
// value conflict detection for `currentPhase`/`currentFocus` across
// multiple evidence items, and cross-field conflict detection between a
// completed milestone and a deferred/out-of-scope item naming the exact
// same thing. Deliberately does NOT cross-check milestones against
// non-goals, limitations, technical debt, consequences, or next actions --
// those are not the same kind of claim (project-domain.md's "evidence may
// disagree" principle does not license inventing a conflict between two
// unlike categories). Never re-parses a document itself -- all document
// reading stays inside the extractors this module calls.

import type { EvidenceSnapshot, EvidenceSnapshotItem } from "./evidenceSnapshotTypes";
import {
  MAX_BRIEF_ITEM_TEXT_LENGTH,
  MAX_BRIEF_ITEMS_PER_FIELD,
  PROJECT_BRIEF_VERSION,
  type BriefProvenance,
  type ProjectBrief,
  type ProjectBriefBuildResult,
  type ProjectBriefExtractionWarning,
  type ProjectBriefSingleValueField,
  type ProjectBriefTextItem,
  type ProjectBriefValidationIssue,
} from "./projectBriefTypes";
import type { ProjectBriefExtractedItem, ProjectBriefExtractorInput } from "./projectBriefExtractorTypes";
import { extractProjectStatusDocument } from "./projectBriefProjectStatusExtractor";
import { extractAdrDocument } from "./projectBriefAdrExtractor";
import { extractRoadmapDocument } from "./projectBriefRoadmapExtractor";
import { extractArchitectureDocument } from "./projectBriefArchitectureExtractor";
import { extractProductDirectionDocument } from "./projectBriefProductDirectionExtractor";

export interface ProjectBriefIdentity {
  readonly id: string;
  readonly name: string;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function compareProvenance(a: BriefProvenance, b: BriefProvenance): number {
  if (a.sourceKind !== b.sourceKind) return a.sourceKind < b.sourceKind ? -1 : 1;
  if (a.sourceReference !== b.sourceReference) return a.sourceReference < b.sourceReference ? -1 : 1;
  if (a.sourceEvidenceId !== b.sourceEvidenceId) return a.sourceEvidenceId < b.sourceEvidenceId ? -1 : 1;
  return 0;
}

/** Deterministic total order: provenance (source kind, reference, evidence id), then text as a final tie-breaker. Never the order items were pushed during extraction. */
function compareExtractedItems(a: ProjectBriefExtractedItem, b: ProjectBriefExtractedItem): number {
  const byProvenance = compareProvenance(a.provenance, b.provenance);
  if (byProvenance !== 0) return byProvenance;
  if (a.text === b.text) return 0;
  return a.text < b.text ? -1 : 1;
}

/** Sorts deterministically, then collapses items whose normalized text is identical -- multiple sources verbatim-corroborating the same fact, not a conflict. The first item per the deterministic order is kept; this is a within-this-assembly-run stable tie-breaker, never a cross-source "latest wins." */
function dedupeByNormalizedText(items: readonly ProjectBriefExtractedItem[]): readonly ProjectBriefExtractedItem[] {
  const sorted = [...items].sort(compareExtractedItems);
  const seen = new Set<string>();
  const result: ProjectBriefExtractedItem[] = [];
  for (const item of sorted) {
    const key = normalizeText(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function toTextItems(items: readonly ProjectBriefExtractedItem[]): readonly ProjectBriefTextItem[] {
  return items.map((item) => ({ text: item.text, provenance: item.provenance }));
}

/**
 * Zero candidates -> unknown. One distinct (by normalized text) candidate,
 * possibly corroborated verbatim by more than one source -> known, traced
 * to the deterministically-first corroborating source. More than one
 * distinct candidate -> conflicted, every distinct candidate preserved --
 * never resolved by array order, timestamp, or source preference.
 */
function resolveSingleValueField(candidates: readonly ProjectBriefExtractedItem[]): ProjectBriefSingleValueField<string> {
  if (candidates.length === 0) return { status: "unknown" };
  const distinct = dedupeByNormalizedText(candidates);
  if (distinct.length === 1) {
    return { status: "known", value: distinct[0].text, provenance: distinct[0].provenance };
  }
  return { status: "conflicted", candidates: distinct.map((item) => ({ value: item.text, provenance: item.provenance })) };
}

/**
 * Cross-checks completed milestones against deferred/out-of-scope items
 * only -- the one pair of categories where the source documents
 * themselves make comparable claims about the same named item ("this is
 * done" vs. "this is deferred"/"this is out of scope"). Deliberately never
 * checked against non-goals, limitations, technical debt, or any other
 * category: a non-goal is a scope decision, not a claim about a specific
 * named item's completion, and treating it as a conflict partner would
 * invent a disagreement the sources never state. Both statements are
 * always kept; the milestone item is only additionally annotated.
 */
function markMilestoneConflicts(
  milestones: readonly ProjectBriefExtractedItem[],
  deferredOrOutOfScope: readonly ProjectBriefExtractedItem[],
): { readonly milestones: readonly ProjectBriefTextItem[]; readonly warnings: readonly ProjectBriefExtractionWarning[] } {
  const byNormalizedText = new Map<string, BriefProvenance[]>();
  for (const item of deferredOrOutOfScope) {
    const key = normalizeText(item.text);
    const list = byNormalizedText.get(key) ?? [];
    list.push(item.provenance);
    byNormalizedText.set(key, list);
  }

  const warnings: ProjectBriefExtractionWarning[] = [];
  const result: ProjectBriefTextItem[] = milestones.map((milestone) => {
    const conflicting = byNormalizedText.get(normalizeText(milestone.text));
    if (!conflicting) return { text: milestone.text, provenance: milestone.provenance };
    warnings.push({
      code: "CONFLICTING_CANONICAL_STATEMENT",
      message: `"${milestone.text}" is listed as a completed milestone by one source and as a deferred/out-of-scope item by another.`,
      sourceEvidenceId: milestone.provenance.sourceEvidenceId,
      sourceReference: milestone.provenance.sourceReference,
    });
    return { text: milestone.text, provenance: milestone.provenance, conflictedWith: conflicting };
  });
  return { milestones: result, warnings };
}

function buildSourceReferences(items: readonly EvidenceSnapshotItem[], contributingIds: ReadonlySet<string>): readonly BriefProvenance[] {
  const refs: BriefProvenance[] = items
    .filter((item) => contributingIds.has(item.evidenceId))
    .map((item) => ({ sourceEvidenceId: item.evidenceId, sourceReference: item.reference, sourceKind: item.sourceKind }));
  return [...refs].sort(compareProvenance);
}

/** Mirrors projectContextBuilder.ts's own deep-freeze convention. Safe to apply directly here (no clone-first step needed) because every object reachable from `brief` was freshly constructed within this module -- never an alias of the caller-owned `project`/`snapshot` input, which this function never mutates or freezes. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) {
    deepFreeze(entry);
  }
  return value;
}

function validateProjectBrief(brief: ProjectBrief): ProjectBriefBuildResult {
  const errors: ProjectBriefValidationIssue[] = [];
  const fields: { readonly name: string; readonly items: readonly ProjectBriefTextItem[] }[] = [
    { name: "completedMilestones", items: brief.completedMilestones },
    { name: "openDecisions", items: brief.openDecisions },
    { name: "acceptedDecisions", items: brief.acceptedDecisions },
    { name: "knownRisks", items: brief.knownRisks },
    { name: "explicitNextActions", items: brief.explicitNextActions },
    { name: "decisionConsequences", items: brief.decisionConsequences },
    { name: "limitations", items: brief.limitations },
    { name: "technicalDebt", items: brief.technicalDebt },
    { name: "nonGoals", items: brief.nonGoals },
    { name: "deferredItems", items: brief.deferredItems },
    { name: "outOfScope", items: brief.outOfScope },
  ];

  for (const field of fields) {
    if (field.items.length > MAX_BRIEF_ITEMS_PER_FIELD) {
      errors.push({ code: "TOO_MANY_ITEMS", message: `${field.name} has more than ${MAX_BRIEF_ITEMS_PER_FIELD} items.`, field: field.name });
    }
    for (const item of field.items) {
      if (item.text.trim().length === 0) {
        errors.push({ code: "EMPTY_TEXT", message: `${field.name} contains an empty item.`, field: field.name });
      }
      if (item.text.length > MAX_BRIEF_ITEM_TEXT_LENGTH) {
        errors.push({ code: "TEXT_TOO_LONG", message: `${field.name} contains an item exceeding ${MAX_BRIEF_ITEM_TEXT_LENGTH} characters.`, field: field.name });
      }
      if (!item.provenance.sourceEvidenceId || !item.provenance.sourceReference || !item.provenance.sourceKind) {
        errors.push({ code: "MISSING_PROVENANCE", message: `${field.name} contains an item without complete provenance.`, field: field.name });
      }
    }
  }

  const seenSourceRefs = new Set<string>();
  for (const ref of brief.sourceReferences) {
    if (seenSourceRefs.has(ref.sourceEvidenceId)) {
      errors.push({
        code: "DUPLICATE_SOURCE_REFERENCE",
        message: `sourceReferences contains evidence id "${ref.sourceEvidenceId}" more than once.`,
        field: "sourceReferences",
      });
    }
    seenSourceRefs.add(ref.sourceEvidenceId);
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, brief: deepFreeze(brief) };
}

/**
 * Builds a ProjectBrief from an already-selected, already-validated
 * EvidenceSnapshot. Pure: no filesystem, network, clock read
 * (`generatedAt` is injected by the caller), or hidden mutable state.
 * Fails closed with `NO_SUPPORTED_CONTENT` when not one evidence item in
 * the snapshot produced any extractable fact -- an all-empty "successful"
 * brief would misrepresent an unsupported/empty evidence set as one that
 * was genuinely evaluated and found to have nothing to report.
 */
export function buildProjectBriefFromSnapshot(
  project: ProjectBriefIdentity,
  snapshot: EvidenceSnapshot,
  generatedAt: string,
): ProjectBriefBuildResult {
  const warnings: ProjectBriefExtractionWarning[] = [];
  const currentPhaseCandidates: ProjectBriefExtractedItem[] = [];
  const currentFocusCandidates: ProjectBriefExtractedItem[] = [];
  const completedMilestonesRaw: ProjectBriefExtractedItem[] = [];
  const openDecisionsRaw: ProjectBriefExtractedItem[] = [];
  const acceptedDecisionsRaw: ProjectBriefExtractedItem[] = [];
  const knownRisksRaw: ProjectBriefExtractedItem[] = [];
  const explicitNextActionsRaw: ProjectBriefExtractedItem[] = [];
  const decisionConsequencesRaw: ProjectBriefExtractedItem[] = [];
  const limitationsRaw: ProjectBriefExtractedItem[] = [];
  const technicalDebtRaw: ProjectBriefExtractedItem[] = [];
  const nonGoalsRaw: ProjectBriefExtractedItem[] = [];
  const deferredItemsRaw: ProjectBriefExtractedItem[] = [];
  const outOfScopeRaw: ProjectBriefExtractedItem[] = [];
  const contributingEvidenceIds = new Set<string>();

  for (const item of snapshot.items) {
    const input: ProjectBriefExtractorInput = {
      evidenceId: item.evidenceId,
      sourceReference: item.reference,
      sourceKind: item.sourceKind,
      textContent: item.textContent,
    };
    let contributed = false;

    if (item.sourceKind === "project_status_document") {
      const { facts, warnings: w } = extractProjectStatusDocument(input);
      warnings.push(...w);
      if (facts.currentPhase) {
        currentPhaseCandidates.push(facts.currentPhase);
        contributed = true;
      }
      if (facts.currentFocus) {
        currentFocusCandidates.push(facts.currentFocus);
        contributed = true;
      }
      if (facts.completedMilestones.length > 0) {
        completedMilestonesRaw.push(...facts.completedMilestones);
        contributed = true;
      }
      if (facts.explicitNextActions.length > 0) {
        explicitNextActionsRaw.push(...facts.explicitNextActions);
        contributed = true;
      }
      if (facts.technicalDebt.length > 0) {
        technicalDebtRaw.push(...facts.technicalDebt);
        contributed = true;
      }
      if (facts.limitations.length > 0) {
        limitationsRaw.push(...facts.limitations);
        contributed = true;
      }
    } else if (item.sourceKind === "adr") {
      const { facts, warnings: w } = extractAdrDocument(input);
      warnings.push(...w);
      if (facts.acceptedDecision) {
        acceptedDecisionsRaw.push(facts.acceptedDecision);
        contributed = true;
      }
      if (facts.consequences.length > 0) {
        // Every Consequences bullet is preserved verbatim here,
        // unconditionally -- a consequence is not automatically an action.
        decisionConsequencesRaw.push(...facts.consequences);
        contributed = true;
      }
      if (facts.nextActions.length > 0) {
        // Only the subset of those same bullets that also carry the
        // literal "Next action:" label.
        explicitNextActionsRaw.push(...facts.nextActions);
        contributed = true;
      }
      if (facts.deferredDecisions.length > 0) {
        openDecisionsRaw.push(...facts.deferredDecisions);
        contributed = true;
      }
    } else if (item.sourceKind === "roadmap_document") {
      const { facts, warnings: w } = extractRoadmapDocument(input);
      warnings.push(...w);
      if (facts.deferredItems.length > 0) {
        deferredItemsRaw.push(...facts.deferredItems);
        contributed = true;
      }
      if (facts.outOfScope.length > 0) {
        outOfScopeRaw.push(...facts.outOfScope);
        contributed = true;
      }
      if (facts.risks.length > 0) {
        knownRisksRaw.push(...facts.risks);
        contributed = true;
      }
      if (facts.limitations.length > 0) {
        limitationsRaw.push(...facts.limitations);
        contributed = true;
      }
      if (facts.currentFocus) {
        currentFocusCandidates.push(facts.currentFocus);
        contributed = true;
      }
    } else if (item.sourceKind === "architecture_document") {
      const { facts, warnings: w } = extractArchitectureDocument(input);
      warnings.push(...w);
      if (facts.openDecisions.length > 0) {
        openDecisionsRaw.push(...facts.openDecisions);
        contributed = true;
      }
      if (facts.nonGoals.length > 0) {
        nonGoalsRaw.push(...facts.nonGoals);
        contributed = true;
      }
      if (facts.outOfScope.length > 0) {
        outOfScopeRaw.push(...facts.outOfScope);
        contributed = true;
      }
      if (facts.limitations.length > 0) {
        limitationsRaw.push(...facts.limitations);
        contributed = true;
      }
    } else if (item.sourceKind === "product_direction_document") {
      const { facts, warnings: w } = extractProductDirectionDocument(input);
      warnings.push(...w);
      if (facts.nonGoals.length > 0) {
        nonGoalsRaw.push(...facts.nonGoals);
        contributed = true;
      }
      if (facts.limitations.length > 0) {
        limitationsRaw.push(...facts.limitations);
        contributed = true;
      }
    } else {
      warnings.push({
        code: "UNSUPPORTED_SOURCE_KIND",
        message: `Evidence of source kind "${item.sourceKind}" is not a supported Project Brief input in this slice and was ignored.`,
        sourceEvidenceId: item.evidenceId,
        sourceReference: item.reference,
      });
    }

    if (contributed) contributingEvidenceIds.add(item.evidenceId);
  }

  const currentPhase = resolveSingleValueField(currentPhaseCandidates);
  const currentFocus = resolveSingleValueField(currentFocusCandidates);
  const dedupedMilestones = dedupeByNormalizedText(completedMilestonesRaw);
  const openDecisions = dedupeByNormalizedText(openDecisionsRaw);
  const acceptedDecisions = dedupeByNormalizedText(acceptedDecisionsRaw);
  const knownRisks = dedupeByNormalizedText(knownRisksRaw);
  const explicitNextActions = dedupeByNormalizedText(explicitNextActionsRaw);
  const decisionConsequences = dedupeByNormalizedText(decisionConsequencesRaw);
  const limitations = dedupeByNormalizedText(limitationsRaw);
  const technicalDebt = dedupeByNormalizedText(technicalDebtRaw);
  const nonGoals = dedupeByNormalizedText(nonGoalsRaw);
  const deferredItems = dedupeByNormalizedText(deferredItemsRaw);
  const outOfScope = dedupeByNormalizedText(outOfScopeRaw);

  const { milestones: completedMilestones, warnings: conflictWarnings } = markMilestoneConflicts(dedupedMilestones, [
    ...deferredItems,
    ...outOfScope,
  ]);
  warnings.push(...conflictWarnings);

  const hasAnyContent =
    currentPhase.status !== "unknown" ||
    currentFocus.status !== "unknown" ||
    completedMilestones.length > 0 ||
    openDecisions.length > 0 ||
    acceptedDecisions.length > 0 ||
    knownRisks.length > 0 ||
    explicitNextActions.length > 0 ||
    decisionConsequences.length > 0 ||
    limitations.length > 0 ||
    technicalDebt.length > 0 ||
    nonGoals.length > 0 ||
    deferredItems.length > 0 ||
    outOfScope.length > 0;

  if (!hasAnyContent) {
    return {
      valid: false,
      errors: [
        {
          code: "NO_SUPPORTED_CONTENT",
          message: "No supported canonical document in the evidence snapshot produced any extractable Project Brief content.",
        },
      ],
    };
  }

  const brief: ProjectBrief = {
    briefVersion: PROJECT_BRIEF_VERSION,
    // Copied, not aliased -- `deepFreeze` below must never freeze the
    // caller-owned `project` argument.
    project: { id: project.id, name: project.name },
    generatedAt,
    snapshotHash: snapshot.snapshotHash,
    evidenceIds: [...snapshot.items.map((item) => item.evidenceId)].sort(),
    currentPhase,
    currentFocus,
    completedMilestones,
    openDecisions: toTextItems(openDecisions),
    acceptedDecisions: toTextItems(acceptedDecisions),
    knownRisks: toTextItems(knownRisks),
    explicitNextActions: toTextItems(explicitNextActions),
    decisionConsequences: toTextItems(decisionConsequences),
    limitations: toTextItems(limitations),
    technicalDebt: toTextItems(technicalDebt),
    nonGoals: toTextItems(nonGoals),
    deferredItems: toTextItems(deferredItems),
    outOfScope: toTextItems(outOfScope),
    extractionWarnings: warnings,
    sourceReferences: buildSourceReferences(snapshot.items, contributingEvidenceIds),
  };

  return validateProjectBrief(brief);
}
