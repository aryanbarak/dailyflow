import { describe, expect, it, vi } from "vitest";

// contextRebuildService.ts (imported transitively by projectBriefService.ts)
// constructs the production Supabase client at module-import time even
// though every test here injects its own `contextRebuildService`
// dependency and never touches the real one -- mocked here purely to keep
// that unused production singleton from attempting a real client
// initialization during the test run, mirroring contextRebuildService.test.ts.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } },
}));

import { createProjectBriefService } from "./projectBriefService";
import { ProjectBriefError } from "./projectBriefServiceTypes";
import { ContextRebuildError } from "./contextRebuildTypes";
import type { ContextRebuildService } from "./contextRebuildService";
import type { RebuildProjectContextResult } from "./contextRebuildTypes";
import type { EvidenceSnapshot, EvidenceSnapshotItem } from "./evidenceSnapshotTypes";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-03T00:00:01.000Z";

function snapshotItem(overrides: Partial<EvidenceSnapshotItem> = {}): EvidenceSnapshotItem {
  const textContent = (overrides.textContent as string | undefined) ?? "## 3. Completed Milestones\n\n- Default\n";
  return {
    evidenceId: "evidence-1",
    sourceKind: "project_status_document",
    classification: "canonical_document_observation",
    title: "PROJECT_STATUS.md",
    reference: "PROJECT_STATUS.md",
    collectedAt: "2026-08-02T00:00:00.000Z",
    adapterIdentity: "repository-document-adapter",
    adapterVersion: "1.0.0",
    verificationMethod: "deterministic file read",
    contentHash: "a".repeat(64),
    textContent,
    mimeType: "text/markdown",
    byteLength: new TextEncoder().encode(textContent).length,
    ...overrides,
  };
}

function snapshot(items: EvidenceSnapshotItem[]): EvidenceSnapshot {
  return {
    schemaVersion: "evidence-snapshot-v1",
    projectId: PROJECT_ID,
    ownerId: "user-1",
    projectRecordVersion: 1,
    snapshotCreatedAt: "2026-08-03T00:00:00.000Z",
    items,
    excludedSupersededEvidenceIds: [],
    snapshotHash: "b".repeat(64),
  };
}

function fakeRebuild(
  resultOrError: RebuildProjectContextResult | Error,
): Pick<ContextRebuildService, "rebuildProjectContext"> {
  return {
    rebuildProjectContext: vi.fn(async () => {
      if (resultOrError instanceof Error) throw resultOrError;
      return resultOrError;
    }),
  };
}

function readyResult(items: EvidenceSnapshotItem[]): RebuildProjectContextResult {
  return {
    status: "snapshot_ready_context_not_derivable",
    project: { id: PROJECT_ID, type: "software_project", name: "SmartFlow" },
    snapshot: snapshot(items),
    rebuildMetadata: {
      projectId: PROJECT_ID,
      projectRecordVersion: 1,
      snapshotCreatedAt: "2026-08-03T00:00:00.000Z",
      newestEvidenceCollectedAt: "2026-08-02T00:00:00.000Z",
      includedEvidenceCount: items.length,
      excludedSupersededEvidenceCount: 0,
      snapshotHash: "b".repeat(64),
      status: "snapshot_ready_context_not_derivable",
    },
    reasonCode: "EVIDENCE_TO_CONTEXT_TRANSFORMATION_UNSUPPORTED",
    reason: "not derivable in this fixture",
  };
}

describe("projectBriefService", () => {
  it("delegates entirely to the injected Context Rebuild dependency, passing the project id through unchanged", async () => {
    const rebuild = fakeRebuild(readyResult([snapshotItem()]));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    await service.buildProjectBrief(PROJECT_ID);
    expect(rebuild.rebuildProjectContext).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("maps an UNAUTHENTICATED Context Rebuild failure to a typed UNAUTHENTICATED ProjectBriefError", async () => {
    const rebuild = fakeRebuild(new ContextRebuildError("UNAUTHENTICATED", "sign in required"));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    const error = await service.buildProjectBrief(PROJECT_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectBriefError);
    expect((error as ProjectBriefError).code).toBe("UNAUTHENTICATED");
  });

  it("maps a PROJECT_NOT_FOUND Context Rebuild failure through unchanged (non-disclosing, identical for cross-user and nonexistent)", async () => {
    const rebuild = fakeRebuild(new ContextRebuildError("PROJECT_NOT_FOUND", "not found"));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    const error = await service.buildProjectBrief(PROJECT_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectBriefError);
    expect((error as ProjectBriefError).code).toBe("PROJECT_NOT_FOUND");
  });

  it("maps a PROJECT_ARCHIVED Context Rebuild failure through unchanged", async () => {
    const rebuild = fakeRebuild(new ContextRebuildError("PROJECT_ARCHIVED", "archived"));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    const error = await service.buildProjectBrief(PROJECT_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectBriefError);
    expect((error as ProjectBriefError).code).toBe("PROJECT_ARCHIVED");
  });

  it("collapses every other Context Rebuild failure into SNAPSHOT_UNAVAILABLE without leaking the raw error", async () => {
    const rebuild = fakeRebuild(new ContextRebuildError("EVIDENCE_READ_FAILED", "connection reset by peer at 10.0.0.4"));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    const error = await service.buildProjectBrief(PROJECT_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectBriefError);
    expect((error as ProjectBriefError).code).toBe("SNAPSHOT_UNAVAILABLE");
    expect((error as ProjectBriefError).message).not.toMatch(/10\.0\.0\.4/);
  });

  it("maps an unexpected non-ContextRebuildError throw to REBUILD_FAILED without leaking the raw error", async () => {
    const rebuild = fakeRebuild(new Error("raw database internals leaked here"));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    const error = await service.buildProjectBrief(PROJECT_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectBriefError);
    expect((error as ProjectBriefError).code).toBe("REBUILD_FAILED");
    expect((error as ProjectBriefError).message).not.toMatch(/database internals/);
  });

  it("throws NO_SUPPORTED_BRIEF_CONTENT when the snapshot has no supported document content", async () => {
    const rebuild = fakeRebuild(readyResult([]));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    const error = await service.buildProjectBrief(PROJECT_ID).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectBriefError);
    expect((error as ProjectBriefError).code).toBe("NO_SUPPORTED_BRIEF_CONTENT");
  });

  it("returns a successful brief carrying non-empty extractionWarnings when a supported document only partially matches the expected shape", async () => {
    const doc = "## 3. Completed Milestones\n\n- Item One\n";
    const rebuild = fakeRebuild(readyResult([snapshotItem({ textContent: doc })]));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    const brief = await service.buildProjectBrief(PROJECT_ID);
    expect(brief.completedMilestones.map((m) => m.text)).toEqual(["Item One"]);
    expect(brief.extractionWarnings.some((w) => w.code === "MISSING_EXPECTED_SECTION")).toBe(true);
  });

  it("returns a complete, evidence-backed brief on a fully successful build", async () => {
    const doc = "## 2. Current Project Phase\n\nCurrent phase: X.\n\n## 3. Completed Milestones\n\n- Y\n";
    const rebuild = fakeRebuild(readyResult([snapshotItem({ textContent: doc })]));
    const service = createProjectBriefService({ contextRebuildService: rebuild, now: () => NOW });
    const brief = await service.buildProjectBrief(PROJECT_ID);
    expect(brief.project).toEqual({ id: PROJECT_ID, name: "SmartFlow" });
    expect(brief.generatedAt).toBe(NOW);
    expect(brief.snapshotHash).toBe("b".repeat(64));
    expect(brief.currentPhase).toEqual({ status: "known", value: "X.", provenance: expect.any(Object) });
  });
});
