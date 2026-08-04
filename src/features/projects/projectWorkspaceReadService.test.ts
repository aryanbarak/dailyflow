import { describe, expect, it } from "vitest";
import { createProjectWorkspaceReadService } from "./projectWorkspaceReadService";
import { ContextRebuildError } from "./contextRebuildTypes";
import type { RebuildProjectContextResult } from "./contextRebuildTypes";
import { ProjectBriefError } from "./projectBriefServiceTypes";
import { smartflowProjectWorkspaceFixture } from "./projectWorkspaceFixture";
import type { ProjectRecordRepository } from "./projectRecordRepository";
import type { ProjectEvidenceRepository } from "./projectEvidenceRepository";
import type { ProjectRecord } from "./projectRecordTypes";

const OWNER_ID = "owner-1";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const project: ProjectRecord = {
  id: PROJECT_ID,
  ownerId: OWNER_ID,
  type: "software_project",
  name: "SmartFlow",
  status: "active",
  enabledEvidenceSourceKinds: ["project_status_document"],
  version: 7,
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
};

function createHarness(options: {
  ownerId?: string | null;
  project?: ProjectRecord | null;
  evidenceCount?: number;
  rebuildError?: ContextRebuildError;
  briefError?: ProjectBriefError;
} = {}) {
  const calls: string[] = [];
  const projectRepository: ProjectRecordRepository = {
    insert: async () => project,
    findById: async () => {
      calls.push("project.findById");
      return options.project === undefined ? project : options.project;
    },
    listByOwner: async () => [],
    updateConfig: async () => project,
    archiveActive: async () => project,
  };
  const evidenceRepository: ProjectEvidenceRepository = {
    insert: async () => {
      throw new Error("insert must not be called");
    },
    findById: async () => null,
    listByProject: async () => {
      calls.push("evidence.listByProject");
      return Array.from({ length: options.evidenceCount ?? 1 }, (_, index) => ({ id: `pair-${index}` })) as never;
    },
  };
  const contextRebuildService = {
    rebuildProjectContext: async () => {
      calls.push("context.rebuildProjectContext");
      if (options.rebuildError) throw options.rebuildError;
      const result: RebuildProjectContextResult = {
        status: "snapshot_ready_context_not_derivable",
        project: { id: project.id, name: project.name, type: project.type },
        snapshot: {} as never,
        rebuildMetadata: {
          projectId: project.id,
          projectRecordVersion: project.version,
          snapshotCreatedAt: "2026-08-04T08:00:00.000Z",
          newestEvidenceCollectedAt: "2026-08-04T07:00:00.000Z",
          includedEvidenceCount: 1,
          excludedSupersededEvidenceCount: 0,
          snapshotHash: "a".repeat(64),
          status: "snapshot_ready_context_not_derivable",
        },
        reasonCode: "EVIDENCE_TO_CONTEXT_TRANSFORMATION_UNSUPPORTED",
        reason: "not needed in workspace tests",
      };
      return result;
    },
  };
  const projectBriefService = {
    buildProjectBrief: async () => {
      calls.push("brief.buildProjectBrief");
      if (options.briefError) throw options.briefError;
      return { ...smartflowProjectWorkspaceFixture.brief, project: { id: project.id, name: project.name }, generatedAt: "2026-08-04T08:01:00.000Z" };
    },
  };

  return {
    calls,
    service: createProjectWorkspaceReadService({
      projectRepository,
      evidenceRepository,
      contextRebuildService,
      projectBriefService,
      resolveOwnerId: async () => (options.ownerId === undefined ? OWNER_ID : options.ownerId),
    }),
  };
}

describe("projectWorkspaceReadService", () => {
  it("returns a ready live Project Brief with snapshot metadata for a valid owned active project", async () => {
    const { service, calls } = createHarness();

    const result = await service.readProjectWorkspace(PROJECT_ID);

    expect(result.status).toBe("ready");
    expect(result.project?.id).toBe(PROJECT_ID);
    expect(result.brief?.project.name).toBe("SmartFlow");
    expect(result.snapshotMetadata).toMatchObject({
      projectRecordVersion: 7,
      includedEvidenceCount: 1,
      excludedSupersededEvidenceCount: 0,
      snapshotHash: "a".repeat(64),
    });
    expect(calls).toEqual(["project.findById", "evidence.listByProject", "context.rebuildProjectContext", "brief.buildProjectBrief"]);
  });

  it("returns non-disclosing unavailable/not-found states without fixture fallback", async () => {
    await expect(createHarness({ ownerId: null }).service.readProjectWorkspace(PROJECT_ID)).resolves.toMatchObject({
      status: "unavailable",
      error: { code: "UNAUTHENTICATED" },
    });

    await expect(createHarness({ project: null }).service.readProjectWorkspace(PROJECT_ID)).resolves.toMatchObject({
      status: "failed",
      error: { code: "PROJECT_NOT_FOUND", message: "Project workspace was not found." },
    });
  });

  it("fails closed for archived projects and invalid route ids", async () => {
    await expect(createHarness({ project: { ...project, status: "archived" } }).service.readProjectWorkspace(PROJECT_ID)).resolves.toMatchObject({
      status: "failed",
      error: { code: "PROJECT_ARCHIVED" },
    });

    await expect(createHarness().service.readProjectWorkspace("smartflow")).resolves.toMatchObject({
      status: "unavailable",
      error: { code: "INVALID_PROJECT_ID", message: "Project workspace was not found." },
    });
  });

  it("returns not_refreshed when the project has no persisted evidence", async () => {
    const result = await createHarness({ evidenceCount: 0 }).service.readProjectWorkspace(PROJECT_ID);

    expect(result).toMatchObject({
      status: "not_refreshed",
      project: { id: PROJECT_ID },
      dataState: "No persisted ProjectEvidence exists for this project yet.",
    });
    expect(result.brief).toBeUndefined();
  });

  it("returns no_supported_content and sanitized failures without raw exception text", async () => {
    await expect(
      createHarness({ briefError: new ProjectBriefError("NO_SUPPORTED_BRIEF_CONTENT", "raw extractor detail") }).service.readProjectWorkspace(PROJECT_ID),
    ).resolves.toMatchObject({
      status: "no_supported_content",
      error: { code: "NO_SUPPORTED_BRIEF_CONTENT", message: "No supported Project Brief content was found." },
    });

    await expect(
      createHarness({ rebuildError: new ContextRebuildError("MISSING_OBSERVATION", "raw database detail") }).service.readProjectWorkspace(PROJECT_ID),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "MISSING_OR_MALFORMED_OBSERVATION", message: "Project evidence is missing required readable content." },
    });
  });
});
