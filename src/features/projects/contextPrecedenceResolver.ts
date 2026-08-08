// SmartFlow -- ADR-0009 Decision section 2 precedence enforcement.
//
// Review finding F1 (docs/reviews/2026-08-inferred-context-layer-review.md,
// MAJOR #3): ADR-0009 states "explicit evidence-extracted facts... outrank
// user_confirmed/user_corrected inferred fields, which outrank proposed
// (unconfirmed) inferred fields. Conflicts... surface, never silently
// resolve." contextRebuildService.ts previously concatenated every eligible
// candidate with no ordering at all. This module is the single place that
// rule is actually enforced, before ProjectContextBuilder ever sees the
// input.
//
// Pure, deterministic, synchronous: no I/O, no clock read, no randomness.
// Object key/array iteration order is never relied on for the *outcome* --
// only for which entry is reported first within a tie, which this module
// documents explicitly rather than leaving implicit.
//
// ---------------------------------------------------------------------------
// "Same slot" -- the deterministic, per-kind collision rule
// ---------------------------------------------------------------------------
//
// Two candidate elements of the same kind occupy the SAME slot, and
// therefore compete under precedence, when:
//
//   - objective, milestone: BOTH have status "active" -- this is the one
//     single-slot invariant project-domain.md/ProjectContextBuilder itself
//     already enforces (MULTIPLE_ACTIVE_OBJECTIVES/MILESTONES). Any other
//     status groups by normalized (trimmed, casefolded) primary text
//     instead (see below) -- two non-active entries with different text are
//     independent historical facts (e.g. two different completed
//     milestones) and must never be merged into one slot.
//   - decision, capability: slot = normalized `title`. There is no "at most
//     one active" concept for these kinds in this domain (project-domain.md
//     never states one) -- multiple simultaneous decisions/capabilities are
//     normal. Two entries are only the "same slot" when their title matches
//     exactly after trimming and casefolding; this is deliberately
//     conservative (never semantic similarity, which would require an LLM
//     judgment call this module must not make).
//   - risk, candidate_action: slot = normalized `summary`, by the identical
//     rule.
//
// A slot with only one candidate never conflicts -- it passes through
// unchanged, and callers observing behavior before this module existed will
// see no difference (byte-for-byte backward compatible when every input
// element's slot is unique, which was the previous, unstated, universal
// case).
//
// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------
//
// Within a colliding slot, the elements at the single highest-ranked tier
// present (evidence_extracted > user_declared > inferred_unconfirmed) win.
// If exactly one element occupies that tier, it alone is kept and every
// strictly-lower-tier element in that slot is removed from the output
// arrays -- `reason: "higher_tier_precedence"`. If more than one element
// occupies that same highest tier, this is a genuine, irreconcilable
// same-tier conflict (project-domain.md section 15: "disagreement must
// surface... never resolved by array order or by trusting an LLM's
// ranking") -- ALL of them are kept, never arbitrarily narrowed to one,
// `reason: "same_tier_conflict"`. In either case a
// ProjectContextPrecedenceConflict record is produced so the collision is
// visible in the built ProjectContext, never silently absorbed into array
// order.

import type {
  CandidateProjectAction,
  InferredElementProvenance,
  ProjectCapability,
  ProjectContextPrecedenceConflict,
  ProjectContextPrecedenceConflictKind,
  ProjectContextPrecedenceTier,
  ProjectDecision,
  ProjectMilestone,
  ProjectObjective,
  ProjectRisk,
} from "./projectContextTypes";

const TIER_RANK: Record<ProjectContextPrecedenceTier, number> = {
  evidence_extracted: 0,
  user_declared: 1,
  inferred_unconfirmed: 2,
};

function tierOf(inferredProvenance: InferredElementProvenance | undefined): ProjectContextPrecedenceTier {
  if (!inferredProvenance) return "evidence_extracted";
  return inferredProvenance.stateCategory === "user_declared" ? "user_declared" : "inferred_unconfirmed";
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

interface SlotEntry<T> {
  readonly element: T;
  readonly id: string;
  readonly tier: ProjectContextPrecedenceTier;
  readonly slotKey: string;
}

export interface PrecedenceResolutionResult<T> {
  readonly kept: readonly T[];
  readonly conflicts: readonly ProjectContextPrecedenceConflict[];
}

/**
 * Generic resolver, applied once per kind below. `slotKeyOf` fully encodes
 * this kind's "same slot" rule (see file header) -- this function itself
 * has no kind-specific knowledge.
 */
function resolvePrecedenceGeneric<T>(
  kind: ProjectContextPrecedenceConflictKind,
  elements: readonly T[],
  idOf: (element: T) => string,
  provenanceOf: (element: T) => InferredElementProvenance | undefined,
  slotKeyOf: (element: T) => string,
): PrecedenceResolutionResult<T> {
  const entries: SlotEntry<T>[] = elements.map((element) => ({
    element,
    id: idOf(element),
    tier: tierOf(provenanceOf(element)),
    slotKey: slotKeyOf(element),
  }));

  const bySlot = new Map<string, SlotEntry<T>[]>();
  for (const entry of entries) {
    const group = bySlot.get(entry.slotKey);
    if (group) group.push(entry);
    else bySlot.set(entry.slotKey, [entry]);
  }

  const kept: T[] = [];
  const conflicts: ProjectContextPrecedenceConflict[] = [];

  // Map iteration order follows first-insertion order (the input array's own
  // order), so output ordering is deterministic and stable for a fixed input.
  for (const [slotKey, group] of bySlot) {
    if (group.length === 1) {
      kept.push(group[0].element);
      continue;
    }
    const minRank = Math.min(...group.map((entry) => TIER_RANK[entry.tier]));
    const winners = group.filter((entry) => TIER_RANK[entry.tier] === minRank);
    const superseded = group.filter((entry) => TIER_RANK[entry.tier] !== minRank);
    for (const winner of winners) kept.push(winner.element);
    conflicts.push({
      kind,
      slotKey,
      winners: winners.map((entry) => ({ id: entry.id, tier: entry.tier })),
      superseded: superseded.map((entry) => ({ id: entry.id, tier: entry.tier })),
      reason: winners.length > 1 ? "same_tier_conflict" : "higher_tier_precedence",
    });
  }

  return { kept, conflicts };
}

function objectiveSlotKey(objective: ProjectObjective): string {
  return objective.status === "active" ? "objective:active" : `objective:summary:${normalize(objective.summary)}`;
}

function milestoneSlotKey(milestone: ProjectMilestone): string {
  return milestone.status === "active" ? "milestone:active" : `milestone:title:${normalize(milestone.title)}`;
}

export function resolveObjectivePrecedence(objectives: readonly ProjectObjective[]): PrecedenceResolutionResult<ProjectObjective> {
  return resolvePrecedenceGeneric("objective", objectives, (o) => o.id, (o) => o.inferredProvenance, objectiveSlotKey);
}

export function resolveMilestonePrecedence(milestones: readonly ProjectMilestone[]): PrecedenceResolutionResult<ProjectMilestone> {
  return resolvePrecedenceGeneric("milestone", milestones, (m) => m.id, (m) => m.inferredProvenance, milestoneSlotKey);
}

export function resolveDecisionPrecedence(decisions: readonly ProjectDecision[]): PrecedenceResolutionResult<ProjectDecision> {
  return resolvePrecedenceGeneric("decision", decisions, (d) => d.id, (d) => d.inferredProvenance, (d) => `decision:title:${normalize(d.title)}`);
}

export function resolveCapabilityPrecedence(capabilities: readonly ProjectCapability[]): PrecedenceResolutionResult<ProjectCapability> {
  return resolvePrecedenceGeneric("capability", capabilities, (c) => c.id, (c) => c.inferredProvenance, (c) => `capability:title:${normalize(c.title)}`);
}

export function resolveRiskPrecedence(risks: readonly ProjectRisk[]): PrecedenceResolutionResult<ProjectRisk> {
  return resolvePrecedenceGeneric("risk", risks, (r) => r.id, (r) => r.inferredProvenance, (r) => `risk:summary:${normalize(r.summary)}`);
}

export function resolveCandidateActionPrecedence(
  actions: readonly CandidateProjectAction[],
): PrecedenceResolutionResult<CandidateProjectAction> {
  return resolvePrecedenceGeneric("candidate_action", actions, (a) => a.id, (a) => a.inferredProvenance, (a) => `candidate_action:summary:${normalize(a.summary)}`);
}

export interface ResolveAllPrecedenceInput {
  readonly objectives: readonly ProjectObjective[];
  readonly milestones: readonly ProjectMilestone[];
  readonly decisions: readonly ProjectDecision[];
  readonly capabilities: readonly ProjectCapability[];
  readonly risks: readonly ProjectRisk[];
  readonly candidateActions: readonly CandidateProjectAction[];
}

export interface ResolveAllPrecedenceResult {
  readonly objectives: readonly ProjectObjective[];
  readonly milestones: readonly ProjectMilestone[];
  readonly decisions: readonly ProjectDecision[];
  readonly capabilities: readonly ProjectCapability[];
  readonly risks: readonly ProjectRisk[];
  readonly candidateActions: readonly CandidateProjectAction[];
  readonly conflicts: readonly ProjectContextPrecedenceConflict[];
}

/** Orchestrates all six per-kind resolvers. The only entry point contextRebuildService.ts calls. */
export function resolveAllPrecedence(input: ResolveAllPrecedenceInput): ResolveAllPrecedenceResult {
  const objectives = resolveObjectivePrecedence(input.objectives);
  const milestones = resolveMilestonePrecedence(input.milestones);
  const decisions = resolveDecisionPrecedence(input.decisions);
  const capabilities = resolveCapabilityPrecedence(input.capabilities);
  const risks = resolveRiskPrecedence(input.risks);
  const candidateActions = resolveCandidateActionPrecedence(input.candidateActions);
  return {
    objectives: objectives.kept,
    milestones: milestones.kept,
    decisions: decisions.kept,
    capabilities: capabilities.kept,
    risks: risks.kept,
    candidateActions: candidateActions.kept,
    conflicts: [
      ...objectives.conflicts,
      ...milestones.conflicts,
      ...decisions.conflicts,
      ...capabilities.conflicts,
      ...risks.conflicts,
      ...candidateActions.conflicts,
    ],
  };
}
