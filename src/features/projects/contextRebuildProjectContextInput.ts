// SmartFlow -- Context Rebuild Foundation.
//
// Pure mapping only: EvidenceSnapshot + ProjectRecord identity ->
// ProjectContextInput's mechanically-derivable fields (`project`,
// `sources`). Deliberately never populates `objectives`, `milestones`,
// `decisions`, `capabilities`, `risks`, or `candidateActions` -- there is
// currently no deterministic transformation from raw observed text into
// those structured entities without either an LLM (forbidden,
// docs/architecture/project-domain.md section 6) or a semantic document
// parser (out of scope for this slice, see PROJECT_STATUS.md). This module
// proves the mapping contract that DOES exist honestly; it is not itself
// evidence that full ProjectContext derivation is implemented --
// contextRebuildService.ts's `canDeriveProjectContextFromSnapshot` is the
// single, explicit gate this module's output is fed through only when true.

import type { EvidenceSnapshot } from "./evidenceSnapshotTypes";
import type { ProjectContextInput, ProjectSource, SoftwareProject } from "./projectContextTypes";

/** The minimal ProjectRecord identity this mapping needs. */
export interface ContextRebuildProjectIdentity {
  readonly id: string;
  readonly type: SoftwareProject["type"];
  readonly name: string;
}

/**
 * Repository binding is deliberately omitted, not defaulted to
 * `"not_connected"` -- Context Rebuild never queries a provider
 * (docs/architecture/project-evidence-acquisition.md section 22), so it has
 * no honest value to assert for `connectionStatus` either way; asserting
 * one anyway would be exactly the kind of fabricated claim this module
 * exists to avoid. Omitting the field entirely is the only choice that
 * does not fabricate an unverified claim -- ProjectContextBuilder's own
 * validation does not require it.
 */
export function mapProjectToSoftwareProject(project: ContextRebuildProjectIdentity): SoftwareProject {
  return { id: project.id, type: project.type, name: project.name };
}

/** Lossless, non-interpretive: carries forward exactly the provenance ProjectEvidence already recorded. Never infers, summarizes, or ranks. */
export function mapSnapshotItemToProjectSource(item: EvidenceSnapshot["items"][number]): ProjectSource {
  return {
    id: item.evidenceId,
    kind: item.sourceKind,
    title: item.title,
    reference: item.reference,
    retrievedAt: item.collectedAt,
  };
}

/**
 * Builds the mechanically-derivable half of ProjectContextInput.
 * `objectives`/`milestones`/`decisions`/`capabilities`/`risks`/
 * `candidateActions` are always empty arrays here -- see this module's file
 * header. Treating this function's output as "the project's full context"
 * would misrepresent it; it is only ever a valid ProjectContextBuilder
 * input shape, never a claim that the sources it carries have been
 * interpreted.
 */
export function mapEvidenceSnapshotToProjectContextInput(
  project: ContextRebuildProjectIdentity,
  snapshot: EvidenceSnapshot,
  generatedAt: string,
): ProjectContextInput {
  return {
    project: mapProjectToSoftwareProject(project),
    objectives: [],
    milestones: [],
    decisions: [],
    capabilities: [],
    risks: [],
    sources: snapshot.items.map(mapSnapshotItemToProjectSource),
    candidateActions: [],
    generatedAt,
  };
}
