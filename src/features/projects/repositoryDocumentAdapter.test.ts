import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// projectEvidenceService.ts and projectRecordRepository.ts both import the
// real Supabase client module at import time (for their default owner-id
// resolver / production singleton). Every test here injects its own fakes,
// so the real client is never called -- but constructing it eagerly still
// runs createClient(...) against a browser `localStorage` that does not
// exist in this test environment. Mocking the module out avoids that
// unrelated import-time side effect, exactly as projectEvidenceService.test.ts
// already does.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: vi.fn() } },
}));

import { createRepositoryDocumentAdapter } from "./repositoryDocumentAdapter";
import { RepositoryDocumentAdapterError } from "./repositoryDocumentAdapterTypes";
import { createProjectEvidenceService } from "./projectEvidenceService";
import type { ProjectEvidenceRepository } from "./projectEvidenceRepository";
import type { CreateProjectEvidenceResult, ProjectEvidenceWithObservation } from "./projectEvidenceTypes";
import type { ProjectRecord } from "./projectRecordTypes";
import type { ProjectRecordRepository } from "./projectRecordRepository";

const OWNER_A = "user-1";
const OWNER_B = "user-2";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_ARCHIVED = "22222222-2222-4222-8222-222222222222";
const PROJECT_NO_KIND = "33333333-3333-4333-8333-333333333333";
const PROJECT_OTHER_OWNER = "44444444-4444-4444-8444-444444444444";
const PROJECT_ALL_KINDS = "55555555-5555-4555-8555-555555555555";

function createFakeProjectRecordRepository(): ProjectRecordRepository & {
  seed(record: Partial<ProjectRecord> & { id: string; ownerId: string }): void;
} {
  const rows = new Map<string, ProjectRecord>();
  return {
    seed(record) {
      rows.set(record.id, {
        type: "software_project",
        name: "Project",
        status: "active",
        enabledEvidenceSourceKinds: ["architecture_document", "adr", "repository_document", "project_status_document"],
        version: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        ...record,
      } as ProjectRecord);
    },
    async insert() {
      throw new Error("not used by these tests");
    },
    async findById(ownerId, id) {
      const record = rows.get(id);
      return record && record.ownerId === ownerId ? record : null;
    },
    async listByOwner() {
      throw new Error("not used by these tests");
    },
    async updateConfig() {
      throw new Error("not used by these tests");
    },
    async archiveActive() {
      throw new Error("not used by these tests");
    },
  };
}

/** Fakes the real create_project_evidence_with_observation transaction's observable behavior (ADR-0007): content-hash-based duplicate identity, graceful "unchanged" outcome on a fingerprint match. */
function createFakeEvidenceRepository(): ProjectEvidenceRepository {
  const rows = new Map<string, ProjectEvidenceWithObservation>();
  const byFingerprint = new Map<string, string>();
  let nextId = 1;

  return {
    async insert(ownerId, projectId, input): Promise<CreateProjectEvidenceResult> {
      const fingerprint = [projectId, input.sourceKind, input.reference, input.observation.textContent, input.adapterIdentity, input.adapterVersion].join("|");
      const existingId = byFingerprint.get(fingerprint);
      if (existingId) {
        const existing = rows.get(existingId)!;
        return { outcome: "unchanged", evidence: existing.evidence, observation: existing.observation };
      }

      const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
      const evidence: ProjectEvidenceWithObservation["evidence"] = {
        id,
        projectId,
        ownerId,
        sourceKind: input.sourceKind,
        classification: input.classification,
        title: input.title,
        reference: input.reference,
        collectedAt: input.collectedAt,
        adapterIdentity: input.adapterIdentity,
        adapterVersion: input.adapterVersion,
        verificationMethod: input.verificationMethod,
        createdAt: "2026-08-02T00:00:02.000Z",
      };
      if (input.sourceRevision !== undefined) evidence.sourceRevision = input.sourceRevision;
      if (input.confidence !== undefined) evidence.confidence = input.confidence;
      if (input.uncertainty !== undefined) evidence.uncertainty = input.uncertainty;
      if (input.notes !== undefined) evidence.notes = input.notes;
      if (input.supersedesId !== undefined) evidence.supersedesId = input.supersedesId;
      if (input.acquisitionAttemptId !== undefined) evidence.acquisitionAttemptId = input.acquisitionAttemptId;

      const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.observation.textContent));
      const contentHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

      const observation: ProjectEvidenceWithObservation["observation"] = {
        id: `00000000-0000-4000-9000-${String(nextId).padStart(12, "0")}`,
        evidenceId: id,
        projectId,
        ownerId,
        payloadKind: "text",
        textContent: input.observation.textContent,
        mimeType: input.observation.mimeType,
        byteLength: input.observation.byteLength,
        contentHash,
        createdAt: "2026-08-02T00:00:02.000Z",
      };
      if (input.observation.gitRevision !== undefined) observation.gitRevision = input.observation.gitRevision;

      const pair: ProjectEvidenceWithObservation = { evidence, observation };
      rows.set(id, pair);
      byFingerprint.set(fingerprint, id);
      return { outcome: "created", evidence, observation };
    },
    async findById(ownerId, id) {
      const pair = rows.get(id);
      return pair && pair.evidence.ownerId === ownerId ? pair : null;
    },
    async listByProject(ownerId, projectId, options) {
      const owned = [...rows.values()]
        .filter((pair) => pair.evidence.ownerId === ownerId && pair.evidence.projectId === projectId)
        .sort((a, b) => (a.evidence.collectedAt < b.evidence.collectedAt ? 1 : a.evidence.collectedAt > b.evidence.collectedAt ? -1 : 0));
      if (options.includeSuperseded) return owned;
      const supersededIds = new Set(owned.map((pair) => pair.evidence.supersedesId).filter((id): id is string => Boolean(id)));
      return owned.filter((pair) => !supersededIds.has(pair.evidence.id));
    },
  };
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smartflow-adapter-"));
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

async function write(relativePath: string, content: string) {
  const target = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

function buildHarness(options: { ownerId: string | null; clock?: () => string } = { ownerId: OWNER_A }) {
  const projectRepository = createFakeProjectRecordRepository();
  projectRepository.seed({ id: PROJECT_A, ownerId: OWNER_A });
  projectRepository.seed({ id: PROJECT_ARCHIVED, ownerId: OWNER_A, status: "archived" });
  projectRepository.seed({ id: PROJECT_NO_KIND, ownerId: OWNER_A, enabledEvidenceSourceKinds: ["adr"] });
  projectRepository.seed({ id: PROJECT_OTHER_OWNER, ownerId: OWNER_B });
  projectRepository.seed({
    id: PROJECT_ALL_KINDS,
    ownerId: OWNER_A,
    enabledEvidenceSourceKinds: [
      "repository_document",
      "architecture_document",
      "adr",
      "roadmap_document",
      "product_direction_document",
      "project_status_document",
      "verified_repository_state",
      "verified_integration_evidence",
    ],
  });

  const evidenceRepository = createFakeEvidenceRepository();
  const evidenceService = createProjectEvidenceService({
    repository: evidenceRepository,
    projectRepository,
    resolveOwnerId: async () => options.ownerId,
  });

  const clockValue = options.clock ?? (() => "2026-08-02T00:00:00.000Z");
  const adapter = createRepositoryDocumentAdapter({
    repositoryRoot: () => repoRoot,
    resolveOwnerId: async () => options.ownerId,
    projectRepository,
    evidenceService,
    now: clockValue,
  });

  return { adapter, projectRepository, evidenceRepository, evidenceService };
}

describe("repositoryDocumentAdapter: contract", () => {
  it("acquires a valid canonical document with correct provenance", async () => {
    await write("docs/architecture/project-domain.md", "# Project Domain\n");
    const { adapter } = buildHarness();

    const result = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "architecture_document",
      relativePath: "docs/architecture/project-domain.md",
    });

    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    expect(result.evidence.sourceKind).toBe("architecture_document");
    expect(result.evidence.classification).toBe("canonical_document_observation");
    expect(result.evidence.adapterIdentity).toBe("repository-document-adapter");
    expect(result.evidence.adapterVersion).toBe("1.0.0");
    expect(result.evidence.verificationMethod).toBe("deterministic file read");
    expect(result.evidence.projectId).toBe(PROJECT_A);
    expect(result.evidence.reference).toBe("docs/architecture/project-domain.md");
    expect(result.observation.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.observation.textContent).toBe("# Project Domain\n");
    expect(result.observation.mimeType).toBe("text/markdown");
  });

  it("computes the SHA-256 hash over the exact bytes read", async () => {
    await write("PROJECT_STATUS.md", "status content");
    const { adapter } = buildHarness();
    const result = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "project_status_document",
      relativePath: "PROJECT_STATUS.md",
    });
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");

    const expectedDigest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("status content"));
    const expectedHex = Array.from(new Uint8Array(expectedDigest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(result.observation.contentHash).toBe(expectedHex);
  });

  it("records a Git revision on the observation's typed field, never embedded in free-text notes", async () => {
    await write("README.md", "hello");
    await write(".git/HEAD", "ref: refs/heads/main\n");
    await write(".git/refs/heads/main", "3333333333333333333333333333333333333333\n");
    const { adapter } = buildHarness();

    const result = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
    });
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    expect(result.observation.gitRevision).toBe("3333333333333333333333333333333333333333");
    expect(result.evidence.notes).toBeUndefined();
  });

  it("omits gitRevision when the repository root is not a Git checkout", async () => {
    await write("README.md", "hello");
    const { adapter } = buildHarness();
    const result = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
    });
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    expect(result.observation.gitRevision).toBeUndefined();
  });

  it("passes through acquisitionAttemptId when provided", async () => {
    await write("README.md", "hello");
    const { adapter } = buildHarness();
    const result = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
      acquisitionAttemptId: "attempt-1",
    });
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    expect(result.evidence.acquisitionAttemptId).toBe("attempt-1");
  });

  it("returns a defensive-looking ProjectEvidence+Observation pair (no live filesystem handle leaks)", async () => {
    await write("README.md", "hello");
    const { adapter } = buildHarness();
    const result = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
    });
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    expect(typeof result.evidence.id).toBe("string");
    expect(typeof result.observation.id).toBe("string");
    expect(Object.keys(result.evidence)).not.toContain("contentBytes");
    expect(Object.keys(result.evidence)).not.toContain("filePath");
    expect(Object.keys(result.observation)).not.toContain("filePath");
  });
});

describe("repositoryDocumentAdapter: authentication and project boundary", () => {
  it("rejects an unauthenticated caller before any file read", async () => {
    let readAttempted = false;
    await write("README.md", "hello");
    const projectRepository = createFakeProjectRecordRepository();
    projectRepository.seed({ id: PROJECT_A, ownerId: OWNER_A });
    const evidenceRepository = createFakeEvidenceRepository();
    const evidenceService = createProjectEvidenceService({ repository: evidenceRepository, projectRepository, resolveOwnerId: async () => null });
    const adapter = createRepositoryDocumentAdapter({
      repositoryRoot: () => {
        readAttempted = true;
        return repoRoot;
      },
      resolveOwnerId: async () => null,
      projectRepository,
      evidenceService,
    });

    await expect(
      adapter.ingestRepositoryDocument({ projectId: PROJECT_A, sourceKind: "repository_document", relativePath: "README.md" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(readAttempted).toBe(false);
  });

  it("rejects a cross-user project without disclosure", async () => {
    const { adapter } = buildHarness({ ownerId: OWNER_A });
    await expect(
      adapter.ingestRepositoryDocument({ projectId: PROJECT_OTHER_OWNER, sourceKind: "repository_document", relativePath: "README.md" }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("rejects a missing project with the identical error code as a cross-user project, as a typed RepositoryDocumentAdapterError", async () => {
    const { adapter } = buildHarness({ ownerId: OWNER_A });
    let caught: unknown;
    try {
      await adapter.ingestRepositoryDocument({
        projectId: "99999999-9999-4999-8999-999999999999",
        sourceKind: "repository_document",
        relativePath: "README.md",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RepositoryDocumentAdapterError);
    expect((caught as RepositoryDocumentAdapterError).code).toBe("PROJECT_NOT_FOUND");
  });

  it("rejects an archived project", async () => {
    const { adapter } = buildHarness({ ownerId: OWNER_A });
    await expect(
      adapter.ingestRepositoryDocument({ projectId: PROJECT_ARCHIVED, sourceKind: "repository_document", relativePath: "README.md" }),
    ).rejects.toMatchObject({ code: "PROJECT_ARCHIVED" });
  });

  it("rejects a source kind not enabled on the project's configuration", async () => {
    const { adapter } = buildHarness({ ownerId: OWNER_A });
    await expect(
      adapter.ingestRepositoryDocument({ projectId: PROJECT_NO_KIND, sourceKind: "repository_document", relativePath: "README.md" }),
    ).rejects.toMatchObject({ code: "SOURCE_KIND_NOT_ENABLED" });
  });
});

describe("repositoryDocumentAdapter: path security integration", () => {
  it("rejects a path traversal attempt end-to-end", async () => {
    const { adapter } = buildHarness();
    await expect(
      adapter.ingestRepositoryDocument({
        projectId: PROJECT_A,
        sourceKind: "architecture_document",
        relativePath: "docs/architecture/../../secret.md",
      }),
    ).rejects.toMatchObject({ code: "PATH_REJECTED" });
  });

  it("rejects a source-kind/path mismatch end-to-end", async () => {
    await write("docs/architecture/project-domain.md", "content");
    const { adapter } = buildHarness();
    await expect(
      adapter.ingestRepositoryDocument({
        projectId: PROJECT_ALL_KINDS,
        sourceKind: "roadmap_document",
        relativePath: "docs/architecture/project-domain.md",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_KIND_PATH_MISMATCH" });
  });

  it("rejects a source kind this adapter can never support, even when enabled on the project", async () => {
    const { adapter } = buildHarness();
    await expect(
      adapter.ingestRepositoryDocument({
        projectId: PROJECT_ALL_KINDS,
        sourceKind: "verified_repository_state",
        relativePath: "README.md",
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_SOURCE_KIND" });
  });

  it("reports a missing allowlisted file as FILE_NOT_FOUND", async () => {
    const { adapter } = buildHarness();
    await expect(
      adapter.ingestRepositoryDocument({ projectId: PROJECT_A, sourceKind: "repository_document", relativePath: "README.md" }),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });
});

describe("repositoryDocumentAdapter: content and duplication behavior", () => {
  it("creates new evidence when the document content changes", async () => {
    await write("README.md", "version one");
    let tick = 0;
    const clock = () => (tick++ === 0 ? "2026-08-02T00:00:00.000Z" : "2026-08-03T00:00:00.000Z");
    const { adapter } = buildHarness({ ownerId: OWNER_A, clock });

    const first = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
    });
    expect(first.outcome).toBe("created");

    await write("README.md", "version two");
    const second = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
    });
    expect(second.outcome).toBe("created");
    if (first.outcome !== "created" || second.outcome !== "created") throw new Error("unreachable");
    expect(second.evidence.id).not.toBe(first.evidence.id);
    expect(second.observation.contentHash).not.toBe(first.observation.contentHash);
  });

  it("returns an explicit 'unchanged' result for a byte-identical re-acquisition, without creating a duplicate, even at a later collectedAt", async () => {
    await write("README.md", "stable content");
    const projectRepository = createFakeProjectRecordRepository();
    projectRepository.seed({ id: PROJECT_A, ownerId: OWNER_A });
    const evidenceRepository = createFakeEvidenceRepository();
    const evidenceService = createProjectEvidenceService({ repository: evidenceRepository, projectRepository, resolveOwnerId: async () => OWNER_A });
    let tick = 0;
    const clock = () => (tick++ === 0 ? "2026-08-02T00:00:00.000Z" : "2026-09-01T00:00:00.000Z");
    const adapter = createRepositoryDocumentAdapter({
      repositoryRoot: () => repoRoot,
      resolveOwnerId: async () => OWNER_A,
      projectRepository,
      evidenceService,
      now: clock,
    });

    const first = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
    });
    expect(first.outcome).toBe("created");

    const second = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
    });
    expect(second.outcome).toBe("unchanged");
    if (first.outcome !== "created" || second.outcome !== "unchanged") throw new Error("unreachable");
    expect(second.evidence.id).toBe(first.evidence.id);
    expect(second.observation.id).toBe(first.observation.id);

    const all = await evidenceService.listByProject(PROJECT_A, { includeSuperseded: true });
    expect(all).toHaveLength(1);
  });

  it("does not interpret document content: identical evidence is produced regardless of Markdown structure", async () => {
    await write("README.md", "# Heading\n\nSome **bold** text and a [link](https://example.com).\n");
    const { adapter } = buildHarness();
    const result = await adapter.ingestRepositoryDocument({
      projectId: PROJECT_A,
      sourceKind: "repository_document",
      relativePath: "README.md",
    });
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    // The title is deliberately the reference path, never parsed from the
    // document's own heading text.
    expect(result.evidence.title).toBe("README.md");
    expect(result.observation.textContent).toBe("# Heading\n\nSome **bold** text and a [link](https://example.com).\n");
  });
});
