// SmartFlow -- Project Brief Foundation.
//
// Orchestration only: delegates trusted owner resolution, project loading,
// archived-project rejection, evidence reading, and EvidenceSnapshot
// construction entirely to the existing Context Rebuild Foundation
// (contextRebuildService.ts) -- this module never resolves an owner, never
// reads a repository or evidence table itself, and never duplicates that
// logic. It only adds: running the Project Brief extractors against the
// returned snapshot, assembling a typed ProjectBrief, and mapping every
// failure mode into a typed, non-disclosing ProjectBriefError. The brief is
// always returned in-memory -- nothing here persists it.

import type { ContextRebuildService } from "./contextRebuildService";
import { ContextRebuildError } from "./contextRebuildTypes";
import { buildProjectBriefFromSnapshot } from "./projectBriefAssembler";
import type { ProjectBrief } from "./projectBriefTypes";
import { ProjectBriefError, type ProjectBriefErrorCode } from "./projectBriefServiceTypes";

export interface ProjectBriefServiceDependencies {
  /** Only the read used here -- `rebuildProjectContext`. Defaults to the production Context Rebuild singleton. */
  contextRebuildService: Pick<ContextRebuildService, "rebuildProjectContext">;
  /** Injected clock. Defaults to the system clock; tests inject a fixed value. */
  now?: () => string;
}

export interface ProjectBriefService {
  buildProjectBrief(projectId: string): Promise<ProjectBrief>;
}

function toProjectBriefError(error: unknown): ProjectBriefError {
  if (error instanceof ContextRebuildError) {
    if (error.code === "UNAUTHENTICATED") {
      return new ProjectBriefError("UNAUTHENTICATED", "You must be signed in to build a project brief.");
    }
    if (error.code === "PROJECT_NOT_FOUND") {
      return new ProjectBriefError("PROJECT_NOT_FOUND", "Project was not found for this user.");
    }
    if (error.code === "PROJECT_ARCHIVED") {
      return new ProjectBriefError("PROJECT_ARCHIVED", "Cannot build a project brief for an archived project.");
    }
    // Every other Context Rebuild failure (evidence read failure, missing/
    // malformed observation, unsupported classification, snapshot
    // validation failure, builder validation failure, or an unexpected
    // internal rebuild failure) collapses to one code here -- Project
    // Brief only needs to know the snapshot it depends on was not
    // available, never the internal reason, which may carry database or
    // storage detail this boundary must not disclose.
    return new ProjectBriefError("SNAPSHOT_UNAVAILABLE", "The evidence snapshot required to build a project brief is unavailable.");
  }
  // No raw caught exception message ever escapes.
  return new ProjectBriefError("REBUILD_FAILED", "Unable to build a project brief for this project.");
}

export function createProjectBriefService(dependencies: ProjectBriefServiceDependencies): ProjectBriefService {
  const rebuildService = dependencies.contextRebuildService;
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async buildProjectBrief(projectId: string): Promise<ProjectBrief> {
      const rebuildResult = await rebuildService.rebuildProjectContext(projectId).catch((error) => {
        throw toProjectBriefError(error);
      });

      const briefResult = buildProjectBriefFromSnapshot(
        { id: rebuildResult.project.id, name: rebuildResult.project.name },
        rebuildResult.snapshot,
        now(),
      );

      // Explicit `=== false` rather than bare `!briefResult.valid`: this
      // project's tsconfig.app.json sets `strict: false`, under which
      // TypeScript does not reliably narrow a boolean-discriminated union
      // to its `false` member through a plain truthiness check -- the same
      // gotcha documented and worked around in contextRebuildService.ts.
      if (briefResult.valid === false) {
        const [firstError] = briefResult.errors;
        const code: ProjectBriefErrorCode = firstError.code === "NO_SUPPORTED_CONTENT" ? "NO_SUPPORTED_BRIEF_CONTENT" : "BRIEF_VALIDATION_FAILED";
        throw new ProjectBriefError(
          code,
          code === "NO_SUPPORTED_BRIEF_CONTENT"
            ? "No supported canonical document in this project's evidence produced any extractable Project Brief content."
            : "The assembled Project Brief failed validation.",
          briefResult.errors.map((issue) => ({ code: issue.code, message: issue.message, field: issue.field })),
        );
      }

      return briefResult.brief;
    },
  };
}
