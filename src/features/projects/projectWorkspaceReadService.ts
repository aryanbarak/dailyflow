import type { ContextRebuildService } from "./contextRebuildService";
import { ContextRebuildError } from "./contextRebuildTypes";
import type { ContextRebuildMetadata } from "./contextRebuildTypes";
import { ProjectBriefError } from "./projectBriefServiceTypes";
import type { ProjectBriefService } from "./projectBriefService";
import type { ProjectBrief } from "./projectBriefTypes";
import type { ProjectEvidenceRepository } from "./projectEvidenceRepository";
import { ProjectEvidencePersistenceError } from "./projectEvidenceRepository";
import type { ProjectRecordRepository } from "./projectRecordRepository";
import type { ProjectRecord } from "./projectRecordTypes";

export type ProjectWorkspaceReadStatus = "ready" | "not_refreshed" | "no_supported_content" | "unavailable" | "failed";

export type ProjectWorkspaceReadErrorCode =
  | "UNAUTHENTICATED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "INVALID_PROJECT_ID"
  | "EVIDENCE_UNAVAILABLE"
  | "MISSING_OR_MALFORMED_OBSERVATION"
  | "SNAPSHOT_VALIDATION_FAILED"
  | "NO_SUPPORTED_BRIEF_CONTENT"
  | "BRIEF_VALIDATION_FAILED"
  | "BROWSER_COMPOSITION_UNAVAILABLE"
  | "UNEXPECTED_READ_FAILURE";

export interface ProjectWorkspaceSnapshotMetadata {
  readonly projectRecordVersion: number;
  readonly snapshotCreatedAt: string;
  readonly newestEvidenceCollectedAt: string | null;
  readonly includedEvidenceCount: number;
  readonly excludedSupersededEvidenceCount: number;
  readonly snapshotHash: string;
}

export interface ProjectWorkspaceReadError {
  readonly code: ProjectWorkspaceReadErrorCode;
  readonly message: string;
}

export interface ProjectWorkspaceReadResult {
  readonly status: ProjectWorkspaceReadStatus;
  readonly project?: Pick<ProjectRecord, "id" | "name" | "type" | "version" | "status">;
  readonly brief?: ProjectBrief;
  readonly snapshotMetadata?: ProjectWorkspaceSnapshotMetadata;
  readonly dataState: string;
  readonly error?: ProjectWorkspaceReadError;
}

export interface ProjectWorkspaceReadServiceDependencies {
  readonly projectRepository: ProjectRecordRepository;
  readonly evidenceRepository: ProjectEvidenceRepository;
  readonly contextRebuildService: Pick<ContextRebuildService, "rebuildProjectContext">;
  readonly projectBriefService: Pick<ProjectBriefService, "buildProjectBrief">;
  readonly resolveOwnerId: () => Promise<string | null>;
  readonly now?: () => string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function projectSummary(project: ProjectRecord): ProjectWorkspaceReadResult["project"] {
  return {
    id: project.id,
    name: project.name,
    type: project.type,
    version: project.version,
    status: project.status,
  };
}

function metadataFromRebuild(metadata: ContextRebuildMetadata): ProjectWorkspaceSnapshotMetadata {
  return {
    projectRecordVersion: metadata.projectRecordVersion,
    snapshotCreatedAt: metadata.snapshotCreatedAt,
    newestEvidenceCollectedAt: metadata.newestEvidenceCollectedAt,
    includedEvidenceCount: metadata.includedEvidenceCount,
    excludedSupersededEvidenceCount: metadata.excludedSupersededEvidenceCount,
    snapshotHash: metadata.snapshotHash,
  };
}

function failed(code: ProjectWorkspaceReadErrorCode, message: string): ProjectWorkspaceReadResult {
  return {
    status: code === "UNAUTHENTICATED" || code === "INVALID_PROJECT_ID" ? "unavailable" : "failed",
    dataState: "Live Project Brief could not be loaded.",
    error: { code, message },
  };
}

function mapContextError(error: ContextRebuildError): ProjectWorkspaceReadResult {
  if (error.code === "UNAUTHENTICATED") return failed("UNAUTHENTICATED", "Sign in to view this project workspace.");
  if (error.code === "PROJECT_NOT_FOUND") return failed("PROJECT_NOT_FOUND", "Project workspace was not found.");
  if (error.code === "PROJECT_ARCHIVED") return failed("PROJECT_ARCHIVED", "Project workspace is unavailable.");
  if (error.code === "MISSING_OBSERVATION" || error.code === "MALFORMED_OBSERVATION") {
    return failed("MISSING_OR_MALFORMED_OBSERVATION", "Project evidence is missing required readable content.");
  }
  if (error.code === "SNAPSHOT_VALIDATION_FAILED" || error.code === "UNSUPPORTED_EVIDENCE_CLASSIFICATION") {
    return failed("SNAPSHOT_VALIDATION_FAILED", "The evidence snapshot could not be validated.");
  }
  return failed("EVIDENCE_UNAVAILABLE", "Project evidence could not be read.");
}

function mapBriefError(error: ProjectBriefError, project: ProjectRecord, snapshotMetadata: ProjectWorkspaceSnapshotMetadata): ProjectWorkspaceReadResult {
  if (error.code === "NO_SUPPORTED_BRIEF_CONTENT") {
    return {
      status: "no_supported_content",
      project: projectSummary(project),
      snapshotMetadata,
      dataState: "Persisted evidence exists, but no supported canonical Project Brief content was found.",
      error: { code: "NO_SUPPORTED_BRIEF_CONTENT", message: "No supported Project Brief content was found." },
    };
  }
  if (error.code === "BRIEF_VALIDATION_FAILED") {
    return {
      status: "failed",
      project: projectSummary(project),
      snapshotMetadata,
      dataState: "Live Project Brief validation failed.",
      error: { code: "BRIEF_VALIDATION_FAILED", message: "The Project Brief could not be validated." },
    };
  }
  if (error.code === "PROJECT_ARCHIVED") return failed("PROJECT_ARCHIVED", "Project workspace is unavailable.");
  if (error.code === "PROJECT_NOT_FOUND") return failed("PROJECT_NOT_FOUND", "Project workspace was not found.");
  if (error.code === "UNAUTHENTICATED") return failed("UNAUTHENTICATED", "Sign in to view this project workspace.");
  return failed("UNEXPECTED_READ_FAILURE", "Project Brief could not be built.");
}

export function createProjectWorkspaceReadService(dependencies: ProjectWorkspaceReadServiceDependencies) {
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async readProjectWorkspace(projectId: string): Promise<ProjectWorkspaceReadResult> {
      if (!UUID_PATTERN.test(projectId)) {
        return failed("INVALID_PROJECT_ID", "Project workspace was not found.");
      }

      const ownerId = await dependencies.resolveOwnerId();
      if (!ownerId) return failed("UNAUTHENTICATED", "Sign in to view this project workspace.");

      let project: ProjectRecord | null;
      try {
        project = await dependencies.projectRepository.findById(ownerId, projectId);
      } catch {
        return failed("UNEXPECTED_READ_FAILURE", "Project workspace could not be loaded.");
      }
      if (!project) return failed("PROJECT_NOT_FOUND", "Project workspace was not found.");
      if (project.status === "archived") return failed("PROJECT_ARCHIVED", "Project workspace is unavailable.");

      let pairs;
      try {
        pairs = await dependencies.evidenceRepository.listByProject(ownerId, projectId, { includeSuperseded: true });
      } catch (error) {
        if (error instanceof ProjectEvidencePersistenceError && error.message === "Project evidence is missing its required observation.") {
          return failed("MISSING_OR_MALFORMED_OBSERVATION", "Project evidence is missing required readable content.");
        }
        return failed("EVIDENCE_UNAVAILABLE", "Project evidence could not be read.");
      }

      if (pairs.length === 0) {
        return {
          status: "not_refreshed",
          project: projectSummary(project),
          dataState: "No persisted ProjectEvidence exists for this project yet.",
        };
      }

      let rebuild;
      try {
        rebuild = await dependencies.contextRebuildService.rebuildProjectContext(projectId);
      } catch (error) {
        if (error instanceof ContextRebuildError) return mapContextError(error);
        return failed("UNEXPECTED_READ_FAILURE", "Project workspace could not be rebuilt.");
      }
      const snapshotMetadata = metadataFromRebuild(rebuild.rebuildMetadata);

      let brief;
      try {
        brief = await dependencies.projectBriefService.buildProjectBrief(projectId);
      } catch (error) {
        if (error instanceof ProjectBriefError) return mapBriefError(error, project, snapshotMetadata);
        return failed("UNEXPECTED_READ_FAILURE", "Project Brief could not be built.");
      }

      return {
        status: "ready",
        project: projectSummary(project),
        brief,
        snapshotMetadata,
        dataState: "Live persisted Project Brief loaded from existing evidence.",
      };
    },
  };
}

export type ProjectWorkspaceReadService = ReturnType<typeof createProjectWorkspaceReadService>;
