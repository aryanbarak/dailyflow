// SmartFlow -- Context Rebuild Foundation.
//
// Typed contracts for the Context Rebuild service boundary
// (docs/architecture/project-evidence-acquisition.md section 22;
// docs/architecture/project-domain.md sections 13-14). Context Rebuild
// resolves the trusted owner, loads one owned active ProjectRecord and its
// evidence snapshot, evaluates freshness, and -- only when a deterministic
// evidence-to-context transformation actually exists -- invokes
// ProjectContextBuilder. It never fetches a raw source, calls a provider
// API, or an LLM (see contextRebuildBoundaries.test.ts).

import type { EvidenceSnapshot } from "./evidenceSnapshotTypes";
import type { ProjectContext, SoftwareProject } from "./projectContextTypes";

/**
 * `MISSING_OBSERVATION`, `MALFORMED_OBSERVATION`, and
 * `UNSUPPORTED_EVIDENCE_CLASSIFICATION` mirror
 * evidenceSnapshotBuilder.ts's own failure codes where they overlap --
 * Context Rebuild's service layer passes those through directly rather
 * than re-mapping them. `BUILDER_VALIDATION_FAILED` is distinct: it means
 * ProjectContextBuilder itself rejected already-mapped input, never that
 * the snapshot itself was malformed.
 */
export type ContextRebuildErrorCode =
  | "UNAUTHENTICATED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "EVIDENCE_READ_FAILED"
  | "MISSING_OBSERVATION"
  | "MALFORMED_OBSERVATION"
  | "UNSUPPORTED_EVIDENCE_CLASSIFICATION"
  | "SNAPSHOT_VALIDATION_FAILED"
  | "BUILDER_VALIDATION_FAILED"
  | "REBUILD_FAILED";

export interface ContextRebuildErrorIssue {
  code: string;
  message: string;
  path?: string;
}

export class ContextRebuildError extends Error {
  readonly code: ContextRebuildErrorCode;
  readonly issues?: readonly ContextRebuildErrorIssue[];

  constructor(code: ContextRebuildErrorCode, message: string, issues?: readonly ContextRebuildErrorIssue[]) {
    super(message);
    this.name = "ContextRebuildError";
    this.code = code;
    this.issues = issues;
  }
}

/**
 * Machine-readable reason code for a "context not derivable" outcome.
 * Deliberately not part of `ContextRebuildErrorCode` and never thrown --
 * "the snapshot is ready but ProjectContextBuilder cannot yet consume it"
 * is a legitimate, well-formed rebuild outcome, not a failure.
 */
export type ContextNotDerivableReasonCode = "EVIDENCE_TO_CONTEXT_TRANSFORMATION_UNSUPPORTED";

/**
 * Deterministic freshness metadata, computed at rebuild time
 * (docs/architecture/project-domain.md section 14;
 * docs/architecture/project-evidence-acquisition.md section 19). Never
 * mutates ProjectEvidence or ProjectRecord to record this -- it exists only
 * in the returned result.
 */
export interface ContextRebuildMetadata {
  projectId: string;
  projectRecordVersion: number;
  snapshotCreatedAt: string;
  /** Newest `collectedAt` among included evidence items, or `null` when the snapshot has none. */
  newestEvidenceCollectedAt: string | null;
  includedEvidenceCount: number;
  excludedSupersededEvidenceCount: number;
  snapshotHash: string;
  status: "context_ready" | "snapshot_ready_context_not_derivable";
}

export interface RebuildProjectContextReadyResult {
  status: "context_ready";
  project: SoftwareProject;
  snapshot: EvidenceSnapshot;
  context: ProjectContext;
  rebuildMetadata: ContextRebuildMetadata;
}

export interface RebuildProjectContextNotDerivableResult {
  status: "snapshot_ready_context_not_derivable";
  project: SoftwareProject;
  snapshot: EvidenceSnapshot;
  rebuildMetadata: ContextRebuildMetadata;
  reasonCode: ContextNotDerivableReasonCode;
  reason: string;
}

export type RebuildProjectContextResult = RebuildProjectContextReadyResult | RebuildProjectContextNotDerivableResult;
