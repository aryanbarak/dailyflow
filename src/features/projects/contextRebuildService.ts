// SmartFlow -- Context Rebuild Foundation.
//
// Orchestration: resolves the trusted authenticated owner, loads one owned
// active ProjectRecord, loads its evidence+observation pairs, builds a
// deterministic EvidenceSnapshot, and -- only when a deterministic
// evidence-to-context transformation exists (it does not yet in this
// implementation, see `canDeriveProjectContextFromSnapshot`) -- invokes
// ProjectContextBuilder. This module is read-only end to end: it creates,
// updates, or deletes nothing, issues no approval, and calls no tool.
//
// Boundary (docs/architecture/project-evidence-acquisition.md section 22):
// Context Rebuild may only read already-persisted ProjectRecord and
// ProjectEvidence/ProjectEvidenceObservation. It never re-reads a
// repository file, never calls a provider API, never invokes the
// Repository Documents Adapter or any other Evidence Source Adapter, and
// never calls an LLM.

import { supabase } from "@/integrations/supabase/client";
import { buildProjectContext } from "./projectContextBuilder";
import type { ProjectContextBuildResult } from "./projectContextTypes";
import { buildEvidenceSnapshot } from "./evidenceSnapshotBuilder";
import type { EvidenceSnapshot } from "./evidenceSnapshotTypes";
import { mapEvidenceSnapshotToProjectContextInput, mapProjectToSoftwareProject } from "./contextRebuildProjectContextInput";
import {
  ContextRebuildError,
  type ContextRebuildErrorCode,
  type ContextRebuildMetadata,
  type RebuildProjectContextResult,
} from "./contextRebuildTypes";
import {
  ProjectEvidencePersistenceError,
  projectEvidenceRepository,
  type ProjectEvidenceRepository,
} from "./projectEvidenceRepository";
import { projectRecordRepository, type ProjectRecordRepository } from "./projectRecordRepository";
import type { ProjectRecord } from "./projectRecordTypes";

/** Resolves the current trusted authenticated user id, or `null` when unauthenticated. Never derived from request input, localStorage, or component state. */
export type OwnerIdResolver = () => Promise<string | null>;

async function resolveOwnerIdFromSupabaseAuth(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Whether a deterministic evidence-to-ProjectContext transformation exists
 * for the given snapshot. It does not, today: every currently-persisted
 * evidence classification
 * (docs/architecture/project-evidence-acquisition.md section 12) carries
 * raw observed text, never pre-structured objectives, milestones,
 * decisions, capabilities, risks, or candidate actions -- and deriving
 * those from raw text deterministically without an LLM or a semantic
 * document parser is exactly what this slice does not implement (see
 * PROJECT_STATUS.md). This function is the single, explicit gate: a future
 * slice that adds a real deterministic mapping changes this function, not
 * the rest of this service.
 */
export function canDeriveProjectContextFromSnapshot(_snapshot: EvidenceSnapshot): boolean {
  return false;
}

export type EvidenceToContextCapabilityCheck = (snapshot: EvidenceSnapshot) => boolean;

export interface ContextRebuildServiceDependencies {
  projectRepository?: ProjectRecordRepository;
  evidenceRepository?: ProjectEvidenceRepository;
  resolveOwnerId?: OwnerIdResolver;
  /** Injected clock. Defaults to the system clock; tests inject a fixed value. Read exactly once per rebuild call. */
  now?: () => string;
  /**
   * Test-only override point. Production always uses
   * `canDeriveProjectContextFromSnapshot`, which always returns `false`
   * today. Exposed so `contextRebuildService.test.ts` can prove the
   * `context_ready` path is wired correctly through this exact service
   * method end to end, not merely asserted about the mapper/builder pair in
   * isolation.
   */
  canDeriveProjectContext?: EvidenceToContextCapabilityCheck;
}

export interface ContextRebuildService {
  rebuildProjectContext(projectId: string): Promise<RebuildProjectContextResult>;
}

/** Exact message projectEvidenceRepository.ts's listByProject raises for a paired-evidence-without-observation inconsistency. Matched defensively on message text -- the same pattern projectEvidenceRepository.ts's own extractTransactionErrorCode already uses for a different upstream error -- fragile against a message-text change there, acceptable because both live in this same feature module and are covered by that module's own tests. */
const MISSING_OBSERVATION_MESSAGE = "Project evidence is missing its required observation.";

function toContextRebuildError(
  error: unknown,
  fallbackCode: ContextRebuildErrorCode,
  fallbackMessage: string,
): ContextRebuildError {
  if (error instanceof ContextRebuildError) return error;
  if (error instanceof ProjectEvidencePersistenceError) {
    if (error.message === MISSING_OBSERVATION_MESSAGE) {
      return new ContextRebuildError(
        "MISSING_OBSERVATION",
        "Selected project evidence is missing its required observation.",
      );
    }
    return new ContextRebuildError("EVIDENCE_READ_FAILED", "Unable to read project evidence.");
  }
  // No raw caught exception message ever escapes -- it may contain
  // database internals or other information this boundary must not
  // disclose.
  return new ContextRebuildError(fallbackCode, fallbackMessage);
}

function computeNewestCollectedAt(snapshot: EvidenceSnapshot): string | null {
  let newest: string | null = null;
  for (const item of snapshot.items) {
    if (newest === null || item.collectedAt > newest) newest = item.collectedAt;
  }
  return newest;
}

function toRebuildMetadata(
  snapshot: EvidenceSnapshot,
  status: ContextRebuildMetadata["status"],
): ContextRebuildMetadata {
  return {
    projectId: snapshot.projectId,
    projectRecordVersion: snapshot.projectRecordVersion,
    snapshotCreatedAt: snapshot.snapshotCreatedAt,
    newestEvidenceCollectedAt: computeNewestCollectedAt(snapshot),
    includedEvidenceCount: snapshot.items.length,
    excludedSupersededEvidenceCount: snapshot.excludedSupersededEvidenceIds.length,
    snapshotHash: snapshot.snapshotHash,
    status,
  };
}

export function createContextRebuildService(
  dependencies: ContextRebuildServiceDependencies = {},
): ContextRebuildService {
  const projectRepository = dependencies.projectRepository ?? projectRecordRepository;
  const evidenceRepository = dependencies.evidenceRepository ?? projectEvidenceRepository;
  const resolveOwnerId = dependencies.resolveOwnerId ?? resolveOwnerIdFromSupabaseAuth;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const canDeriveProjectContext = dependencies.canDeriveProjectContext ?? canDeriveProjectContextFromSnapshot;

  return {
    async rebuildProjectContext(projectId: string): Promise<RebuildProjectContextResult> {
      // Trusted owner resolution before any repository read -- mirroring
      // projectRecordService.ts / projectEvidenceService.ts's existing
      // convention exactly.
      const ownerId = await resolveOwnerId();
      if (!ownerId) {
        throw new ContextRebuildError("UNAUTHENTICATED", "You must be signed in to rebuild project context.");
      }

      let project: ProjectRecord | null;
      try {
        project = await projectRepository.findById(ownerId, projectId);
      } catch (error) {
        throw toContextRebuildError(error, "REBUILD_FAILED", "Unable to load the project record.");
      }
      // Non-disclosure: a project that does not exist and a project owned
      // by someone else produce the identical error, exactly like every
      // other service in this feature.
      if (!project) {
        throw new ContextRebuildError("PROJECT_NOT_FOUND", "Project was not found for this user.");
      }
      if (project.status === "archived") {
        throw new ContextRebuildError("PROJECT_ARCHIVED", "Cannot rebuild context for an archived project.");
      }

      let pairs;
      try {
        // includeSuperseded: true -- Context Rebuild owns evidence snapshot
        // selection (docs/architecture/project-evidence-acquisition.md
        // section 22) and performs its own explicit supersession exclusion
        // (evidenceSnapshotBuilder.ts) so an exclusion is always
        // explainable, rather than delegating to the repository's own
        // silent default filter.
        pairs = await evidenceRepository.listByProject(ownerId, projectId, { includeSuperseded: true });
      } catch (error) {
        throw toContextRebuildError(error, "EVIDENCE_READ_FAILED", "Unable to read project evidence.");
      }

      const snapshotCreatedAt = now();
      const snapshotResult = await buildEvidenceSnapshot(
        { id: project.id, ownerId: project.ownerId, version: project.version },
        pairs,
        snapshotCreatedAt,
      );
      // Explicit `=== false` rather than bare `!snapshotResult.valid`:
      // under this project's non-strict tsconfig (tsconfig.app.json,
      // strict: false), TypeScript's control-flow narrowing for a
      // boolean-discriminated union does not reliably narrow to the
      // `valid: false` member through a plain truthiness check, only
      // through an explicit literal comparison -- verified directly
      // against this exact tsconfig before relying on it here.
      if (snapshotResult.valid === false) {
        const [firstIssue] = snapshotResult.errors;
        throw new ContextRebuildError(
          firstIssue.code,
          "The evidence snapshot could not be built from the current evidence set.",
          snapshotResult.errors.map((issue) => ({ code: issue.code, message: issue.message, path: issue.evidenceId })),
        );
      }
      const snapshot = snapshotResult.snapshot;
      const softwareProject = mapProjectToSoftwareProject(project);

      if (!canDeriveProjectContext(snapshot)) {
        return {
          status: "snapshot_ready_context_not_derivable",
          project: softwareProject,
          snapshot,
          rebuildMetadata: toRebuildMetadata(snapshot, "snapshot_ready_context_not_derivable"),
          reasonCode: "EVIDENCE_TO_CONTEXT_TRANSFORMATION_UNSUPPORTED",
          reason:
            "ProjectContextBuilder requires pre-structured objectives, milestones, decisions, capabilities, risks, and candidate actions. Current evidence carries only raw observed text; no deterministic transformation from raw text into those structured entities exists in this implementation (it would require either LLM extraction or a semantic document parser, neither of which this slice implements).",
        };
      }

      // Unreachable while canDeriveProjectContextFromSnapshot always
      // returns false -- kept real (not stubbed out) so a future slice
      // that flips that gate does not also have to build this call site
      // from scratch, and so this exact path is exercised directly in
      // contextRebuildService.test.ts via dependency injection and in
      // contextRebuildProjectContextInput.test.ts against the real
      // buildProjectContext function.
      const contextInput = mapEvidenceSnapshotToProjectContextInput(project, snapshot, snapshotCreatedAt);
      const buildResult: ProjectContextBuildResult = buildProjectContext(contextInput);
      // See the `snapshotResult.valid === false` comment above -- same
      // narrowing constraint applies here.
      if (buildResult.valid === false) {
        throw new ContextRebuildError(
          "BUILDER_VALIDATION_FAILED",
          "ProjectContextBuilder rejected the derived input.",
          buildResult.errors,
        );
      }

      return {
        status: "context_ready",
        project: softwareProject,
        snapshot,
        context: buildResult.context,
        rebuildMetadata: toRebuildMetadata(snapshot, "context_ready"),
      };
    },
  };
}

/** Production singleton, backed by the real Supabase repositories and Supabase Auth session. */
export const contextRebuildService = createContextRebuildService();
