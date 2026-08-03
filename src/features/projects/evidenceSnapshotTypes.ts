// SmartFlow -- Context Rebuild Foundation.
//
// EvidenceSnapshot is a specific, reproducible selection of ProjectEvidence
// records for a project as of a given point
// (docs/architecture/project-evidence-acquisition.md section 5's
// "Evidence Snapshot" term, undesigned until this module). It is not
// ProjectContext, not interpretation, and not execution authority -- it
// carries forward exactly what was already observed and persisted, in a
// deterministic order, with a deterministic identity hash.

import type { ProjectEvidenceClassification } from "./projectEvidenceTypes";
import type { ProjectEvidenceObservationTextMimeType } from "./projectEvidenceObservationTypes";
import type { ProjectSourceKind } from "./projectContextTypes";

export const EVIDENCE_SNAPSHOT_SCHEMA_VERSION = "evidence-snapshot-v1" as const;

/**
 * One selected, non-superseded evidence item carried into the snapshot.
 * Every field here is copied verbatim from the already-persisted, already-
 * validated ProjectEvidence + ProjectEvidenceObservation pair it came from
 * -- nothing here is inferred, summarized, or interpreted.
 */
export interface EvidenceSnapshotItem {
  evidenceId: string;
  sourceKind: ProjectSourceKind;
  classification: ProjectEvidenceClassification;
  title: string;
  reference: string;
  /** Immutable acquisition-time timestamp. Never used to rank or resolve conflicts between items (docs/architecture/project-evidence-acquisition.md section 18) -- only as one component of the deterministic sort order and as freshness metadata. */
  collectedAt: string;
  adapterIdentity: string;
  adapterVersion: string;
  verificationMethod: string;
  /** Present only when this item's own evidence record explicitly supersedes another. Never used to exclude this item itself -- exclusion happens only when some other selected item's `supersedesId` points at this one (see evidenceSnapshotBuilder.ts). */
  supersedesId?: string;
  contentHash: string;
  textContent: string;
  mimeType: ProjectEvidenceObservationTextMimeType;
  byteLength: number;
  gitRevision?: string;
}

/**
 * A deterministic, reproducible selection of a project's current evidence.
 * Two snapshots built from the same underlying evidence rows are
 * structurally identical (same item order, same `snapshotHash`) regardless
 * of what order the database happened to return those rows in.
 */
export interface EvidenceSnapshot {
  schemaVersion: typeof EVIDENCE_SNAPSHOT_SCHEMA_VERSION;
  projectId: string;
  ownerId: string;
  /** The ProjectRecord version this snapshot was built against -- part of context freshness (docs/architecture/project-domain.md section 14). */
  projectRecordVersion: number;
  /** Injected clock value (ISO 8601) -- the snapshot builder never reads the system clock itself. */
  snapshotCreatedAt: string;
  /** Deterministically ordered: source kind, then reference, then collectedAt, then evidence id as a final tie-breaker. Never database return order. */
  items: readonly EvidenceSnapshotItem[];
  /** Evidence ids excluded from `items` because another selected item's `supersedesId` explicitly points at them -- recorded so an exclusion is always explainable, never silent (docs/architecture/project-evidence-acquisition.md section 14). Sorted for determinism. */
  excludedSupersededEvidenceIds: readonly string[];
  /** Deterministic SHA-256 identity over immutable snapshot identity fields (see evidenceSnapshotBuilder.ts's computeSnapshotHash). Provenance and cache identity only -- never execution authority. */
  snapshotHash: string;
}

export type EvidenceSnapshotBuildFailureCode =
  | "MALFORMED_OBSERVATION"
  | "UNSUPPORTED_EVIDENCE_CLASSIFICATION"
  | "SNAPSHOT_VALIDATION_FAILED";

export interface EvidenceSnapshotBuildIssue {
  code: EvidenceSnapshotBuildFailureCode;
  message: string;
  evidenceId?: string;
}

export type EvidenceSnapshotBuildResult =
  | { valid: true; snapshot: EvidenceSnapshot }
  | { valid: false; errors: readonly EvidenceSnapshotBuildIssue[] };
