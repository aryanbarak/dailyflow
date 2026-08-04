import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { refreshLocalProject, LocalProjectRefreshError } from "./localProjectRefreshService";
import { RepositoryDocumentAdapterError } from "./repositoryDocumentAdapterTypes";
import type { ProjectRecord } from "./projectRecordTypes";
import type { ProjectRecordRepository } from "./projectRecordRepository";
import type { ProjectEvidenceService } from "./projectEvidenceService";
import type { CreateProjectEvidenceInput, ProjectEvidenceWithObservation } from "./projectEvidenceTypes";
import type { ContextRebuildService } from "./contextRebuildService";
import type { RebuildProjectContextResult } from "./contextRebuildTypes";
import { buildEvidenceSnapshot } from "./evidenceSnapshotBuilder";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smartflow-refresh-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

async function write(relativePath: string, content: string) {
  const target = path.join(repoRoot, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

function activeProject(): ProjectRecord {
  return {
    id: PROJECT_ID,
    ownerId: OWNER_ID,
    type: "software_project",
    name: "SmartFlow",
    status: "active",
    enabledEvidenceSourceKinds: [
      "repository_document",
      "architecture_document",
      "adr",
      "roadmap_document",
      "product_direction_document",
      "project_status_document",
    ],
    version: 1,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
}

function projectRepository(project: ProjectRecord | null = activeProject()): ProjectRecordRepository {
  return {
    insert: vi.fn(),
    findById: vi.fn(async () => project),
    listByOwner: vi.fn(),
    updateConfig: vi.fn(),
    archiveActive: vi.fn(),
  } as unknown as ProjectRecordRepository;
}

function evidencePair(reference: string, textContent: string, index: number): ProjectEvidenceWithObservation {
  return {
    evidence: {
      id: `evidence-${index}`,
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      sourceKind: reference === "PROJECT_STATUS.md" ? "project_status_document" : "architecture_document",
      classification: "canonical_document_observation",
      title: reference,
      reference,
      collectedAt: `2026-08-03T00:00:0${index}.000Z`,
      adapterIdentity: "repository-document-adapter",
      adapterVersion: "1.0.0",
      verificationMethod: "deterministic file read",
      createdAt: `2026-08-03T00:00:0${index}.000Z`,
    },
    observation: {
      id: `observation-${index}`,
      evidenceId: `evidence-${index}`,
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      payloadKind: "text",
      textContent,
      mimeType: "text/markdown",
      byteLength: new TextEncoder().encode(textContent).byteLength,
      contentHash: `${index}`.padStart(64, "0"),
      createdAt: `2026-08-03T00:00:0${index}.000Z`,
    },
  };
}

function evidenceService(): ProjectEvidenceService & { pairs: ProjectEvidenceWithObservation[] } {
  const svc = {
    pairs: [] as ProjectEvidenceWithObservation[],
    create: vi.fn(async (input: CreateProjectEvidenceInput) => {
      const existing = svc.pairs.find((pair) => pair.evidence.reference === input.reference && pair.observation.textContent === input.observation.textContent);
      if (existing) return { outcome: "unchanged" as const, ...existing };
      const pair = evidencePair(input.reference, input.observation.textContent, svc.pairs.length + 1);
      pair.evidence.sourceKind = input.sourceKind;
      svc.pairs.push(pair);
      return { outcome: "created" as const, ...pair };
    }),
    getById: vi.fn(),
    listByProject: vi.fn(async () => svc.pairs),
  };
  return svc as ProjectEvidenceService & { pairs: ProjectEvidenceWithObservation[] };
}

function contextService(svc: ProjectEvidenceService & { pairs: ProjectEvidenceWithObservation[] }): Pick<ContextRebuildService, "rebuildProjectContext"> {
  return {
    rebuildProjectContext: vi.fn(async () => {
      const snapshotResult = await buildEvidenceSnapshot(
        { id: PROJECT_ID, ownerId: OWNER_ID, version: 1 },
        svc.pairs,
        "2026-08-03T00:01:00.000Z",
      );
      if (snapshotResult.valid === false) throw new Error("snapshot failed");
      const result: RebuildProjectContextResult = {
        status: "snapshot_ready_context_not_derivable",
        project: { id: PROJECT_ID, name: "SmartFlow", type: "software_project" },
        snapshot: snapshotResult.snapshot,
        rebuildMetadata: {
          projectId: PROJECT_ID,
          projectRecordVersion: 1,
          snapshotCreatedAt: snapshotResult.snapshot.snapshotCreatedAt,
          newestEvidenceCollectedAt: null,
          includedEvidenceCount: snapshotResult.snapshot.items.length,
          excludedSupersededEvidenceCount: 0,
          snapshotHash: snapshotResult.snapshot.snapshotHash,
          status: "snapshot_ready_context_not_derivable",
        },
        reasonCode: "EVIDENCE_TO_CONTEXT_TRANSFORMATION_UNSUPPORTED",
        reason: "not derivable",
      };
      return result;
    }),
  };
}

describe("refreshLocalProject", () => {
  it("refreshes allowed local documents in deterministic order and builds a project brief", async () => {
    await write("docs/architecture/project-domain.md", "## Non-goals\n\n- Browser refresh button\n");
    await write("PROJECT_STATUS.md", "## 2. Current Project Phase\n\nCurrent phase: Sprint 1.\n\nCurrent focus: Local refresh CLI.\n");
    await write("docs/ignored.md", "ignored");
    const evidence = evidenceService();

    const result = await refreshLocalProject(
      { projectId: PROJECT_ID, repositoryRoot: repoRoot },
      {
        resolveOwnerId: async () => OWNER_ID,
        projectRepository: projectRepository(),
        evidenceService: evidence,
        contextRebuildService: contextService(evidence),
        now: () => "2026-08-03T00:02:00.000Z",
      },
    );

    expect(result.counts).toMatchObject({ discovered: 2, created: 2, unchanged: 0, failed: 0 });
    expect(result.documents.map((doc) => doc.reference)).toEqual([
      "docs/architecture/project-domain.md",
      "PROJECT_STATUS.md",
    ].sort((a, b) => a.localeCompare(b)));
    expect(result.projectBrief.currentPhase).toMatchObject({ status: "known", value: "Sprint 1." });
    expect(result.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports unchanged documents on a second refresh without writing repository files", async () => {
    await write("PROJECT_STATUS.md", "## 2. Current Project Phase\n\nCurrent phase: Sprint 1.\n");
    const before = await fs.readFile(path.join(repoRoot, "PROJECT_STATUS.md"), "utf8");
    const evidence = evidenceService();
    const deps = {
      resolveOwnerId: async () => OWNER_ID,
      projectRepository: projectRepository(),
      evidenceService: evidence,
      contextRebuildService: contextService(evidence),
      now: () => "2026-08-03T00:02:00.000Z",
    };

    await refreshLocalProject({ projectId: PROJECT_ID, repositoryRoot: repoRoot }, deps);
    const second = await refreshLocalProject({ projectId: PROJECT_ID, repositoryRoot: repoRoot }, deps);

    expect(second.counts).toMatchObject({ discovered: 1, created: 0, unchanged: 1, failed: 0 });
    await expect(fs.readFile(path.join(repoRoot, "PROJECT_STATUS.md"), "utf8")).resolves.toBe(before);
  });

  it("fails authentication before repository discovery", async () => {
    await write("PROJECT_STATUS.md", "## 2. Current Project Phase\n\nCurrent phase: Sprint 1.\n");
    const repo = projectRepository();
    await expect(
      refreshLocalProject(
        { projectId: PROJECT_ID, repositoryRoot: repoRoot },
        {
          resolveOwnerId: async () => null,
          projectRepository: repo,
          evidenceService: evidenceService(),
          contextRebuildService: contextService(evidenceService()),
        },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" } satisfies Partial<LocalProjectRefreshError>);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("rejects archived projects and disabled repository-document sources", async () => {
    const archived = { ...activeProject(), status: "archived" as const };
    await expect(
      refreshLocalProject(
        { projectId: PROJECT_ID, repositoryRoot: repoRoot },
        {
          resolveOwnerId: async () => OWNER_ID,
          projectRepository: projectRepository(archived),
          evidenceService: evidenceService(),
          contextRebuildService: contextService(evidenceService()),
        },
      ),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });

    const disabled = { ...activeProject(), enabledEvidenceSourceKinds: ["repository_document"] as const };
    await expect(
      refreshLocalProject(
        { projectId: PROJECT_ID, repositoryRoot: repoRoot },
        {
          resolveOwnerId: async () => OWNER_ID,
          projectRepository: projectRepository(disabled),
          evidenceService: evidenceService(),
          contextRebuildService: contextService(evidenceService()),
        },
      ),
    ).rejects.toMatchObject({ code: "EVIDENCE_SOURCE_DISABLED" });
  });

  it("returns failed_partial details when a later document fails after evidence was created", async () => {
    await write("PROJECT_STATUS.md", "## 2. Current Project Phase\n\nCurrent phase: Sprint 1.\n");
    await write("docs/architecture/project-domain.md", "## Non-goals\n\n- UI\n");
    const first = evidencePair("PROJECT_STATUS.md", "x", 1);
    const adapter = {
      ingestRepositoryDocument: vi
        .fn()
        .mockResolvedValueOnce({ outcome: "created" as const, ...first })
        .mockRejectedValueOnce(new RepositoryDocumentAdapterError("INVALID_UTF8", "safe")),
    };

    await expect(
      refreshLocalProject(
        { projectId: PROJECT_ID, repositoryRoot: repoRoot },
        {
          resolveOwnerId: async () => OWNER_ID,
          projectRepository: projectRepository(),
          evidenceService: evidenceService(),
          contextRebuildService: contextService(evidenceService()),
          repositoryDocumentAdapter: adapter,
          now: () => "2026-08-03T00:02:00.000Z",
        },
      ),
    ).rejects.toMatchObject({
      code: "DOCUMENT_READ_FAILURE",
      result: {
        status: "failed_partial",
        partial: true,
        discoveredCount: 2,
        processedCount: 2,
        createdCount: 1,
        failedCount: 1,
        projectBriefAttempted: false,
        projectBriefProduced: false,
      },
    });
  });

  it("returns failed when the first document fails before any persistence", async () => {
    await write("PROJECT_STATUS.md", "## 2. Current Project Phase\n\nCurrent phase: Sprint 1.\n");
    const adapter = {
      ingestRepositoryDocument: vi.fn().mockRejectedValue(new RepositoryDocumentAdapterError("READ_FAILED", "safe")),
    };

    await expect(
      refreshLocalProject(
        { projectId: PROJECT_ID, repositoryRoot: repoRoot },
        {
          resolveOwnerId: async () => OWNER_ID,
          projectRepository: projectRepository(),
          evidenceService: evidenceService(),
          contextRebuildService: contextService(evidenceService()),
          repositoryDocumentAdapter: adapter,
          now: () => "2026-08-03T00:02:00.000Z",
        },
      ),
    ).rejects.toMatchObject({
      result: {
        status: "failed",
        partial: false,
        processedCount: 1,
        createdCount: 0,
        failedCount: 1,
      },
    });
  });

  it("returns failed_partial when brief generation fails after successful acquisition", async () => {
    await write("PROJECT_STATUS.md", "## 2. Current Project Phase\n\nCurrent phase: Sprint 1.\n");
    const evidence = evidenceService();

    await expect(
      refreshLocalProject(
        { projectId: PROJECT_ID, repositoryRoot: repoRoot },
        {
          resolveOwnerId: async () => OWNER_ID,
          projectRepository: projectRepository(),
          evidenceService: evidence,
          contextRebuildService: { rebuildProjectContext: vi.fn(async () => { throw new Error("boom"); }) },
          now: () => "2026-08-03T00:02:00.000Z",
        },
      ),
    ).rejects.toMatchObject({
      code: "SNAPSHOT_BRIEF_FAILURE",
      result: {
        status: "failed_partial",
        partial: true,
        createdCount: 1,
        failedCount: 0,
        projectBriefAttempted: true,
        projectBriefProduced: false,
      },
    });
  });
});
