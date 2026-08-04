import { promises as fs } from "node:fs";
import path from "node:path";
import { buildProjectBriefFromSnapshot } from "./projectBriefAssembler";
import type { ProjectBrief } from "./projectBriefTypes";
import { ProjectBriefError } from "./projectBriefServiceTypes";
import type { ProjectSourceKind } from "./projectContextTypes";
import type { ProjectRecordRepository } from "./projectRecordRepository";
import { createRepositoryDocumentAdapter } from "./repositoryDocumentAdapter";
import { RepositoryDocumentAdapterError, type RepositoryRootResolver } from "./repositoryDocumentAdapterTypes";
import type { RepositoryDocumentAdapter } from "./repositoryDocumentAdapter";
import type { ContextRebuildService } from "./contextRebuildService";
import type { ProjectEvidenceService } from "./projectEvidenceService";

export type LocalProjectRefreshErrorCode =
  | "INVALID_ARGUMENTS"
  | "AUTH_CONFIGURATION_REQUIRED"
  | "UNAUTHENTICATED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "EVIDENCE_SOURCE_DISABLED"
  | "INVALID_REPOSITORY_ROOT"
  | "DOCUMENT_DISCOVERY_FAILURE"
  | "UNSAFE_DOCUMENT_PATH"
  | "DOCUMENT_READ_FAILURE"
  | "EVIDENCE_PERSISTENCE_FAILURE"
  | "SNAPSHOT_BRIEF_FAILURE"
  | "NO_SUPPORTED_BRIEF_CONTENT"
  | "UNEXPECTED_REFRESH_FAILURE";

export class LocalProjectRefreshError extends Error {
  constructor(readonly code: LocalProjectRefreshErrorCode, message: string, readonly result?: LocalProjectRefreshFailureResult) {
    super(message);
    this.name = "LocalProjectRefreshError";
  }
}

export type LocalProjectRefreshDocumentOutcome = "created" | "unchanged" | "skipped" | "failed";

export interface LocalProjectRefreshDocumentResult {
  readonly reference: string;
  readonly sourceKind: ProjectSourceKind;
  readonly outcome: LocalProjectRefreshDocumentOutcome;
  readonly evidenceId?: string;
  readonly contentHash?: string;
  readonly reasonCode?: string;
}

export interface LocalProjectRefreshResult {
  readonly status: "completed";
  readonly partial: false;
  readonly project: { readonly id: string; readonly name: string };
  readonly startedAt: string;
  readonly completedAt: string;
  readonly counts: {
    readonly discovered: number;
    readonly created: number;
    readonly unchanged: number;
    readonly skipped: number;
    readonly failed: number;
  };
  readonly documents: readonly LocalProjectRefreshDocumentResult[];
  readonly snapshotHash: string;
  readonly projectBrief: ProjectBrief;
  readonly extractionWarnings: ProjectBrief["extractionWarnings"];
  readonly conflicts: { readonly currentPhase: boolean; readonly currentFocus: boolean; readonly itemConflictCount: number };
  readonly limitations: readonly string[];
}

export interface LocalProjectRefreshFailureResult {
  readonly status: "failed" | "failed_partial";
  readonly partial: boolean;
  readonly project?: { readonly id: string; readonly name: string };
  readonly startedAt: string;
  readonly failedAt: string;
  readonly discoveredCount: number;
  readonly processedCount: number;
  readonly createdCount: number;
  readonly unchangedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly documents: readonly LocalProjectRefreshDocumentResult[];
  readonly failure: { readonly code: LocalProjectRefreshErrorCode; readonly message: string };
  readonly projectBriefAttempted: boolean;
  readonly projectBriefProduced: boolean;
}

export interface LocalProjectRefreshDependencies {
  resolveOwnerId: () => Promise<string | null>;
  projectRepository: ProjectRecordRepository;
  contextRebuildService: Pick<ContextRebuildService, "rebuildProjectContext">;
  evidenceService: ProjectEvidenceService;
  repositoryDocumentAdapter?: RepositoryDocumentAdapter;
  now?: () => string;
}

const REQUIRED_SOURCE_KINDS: readonly ProjectSourceKind[] = [
  "repository_document",
  "architecture_document",
  "adr",
  "roadmap_document",
  "product_direction_document",
  "project_status_document",
];

const ROOT_FILES: readonly { readonly reference: string; readonly sourceKind: ProjectSourceKind }[] = [
  { reference: "README.md", sourceKind: "repository_document" },
  { reference: "PROJECT_STATUS.md", sourceKind: "project_status_document" },
];

const DOCUMENT_DIRECTORIES: readonly { readonly segments: readonly string[]; readonly sourceKind: ProjectSourceKind }[] = [
  { segments: ["docs", "architecture"], sourceKind: "architecture_document" },
  { segments: ["docs", "decisions", "adr"], sourceKind: "adr" },
  { segments: ["docs", "product"], sourceKind: "product_direction_document" },
  { segments: ["docs", "roadmap"], sourceKind: "roadmap_document" },
];

const NULL_BYTE = String.fromCharCode(0);

async function resolveTrustedRepositoryRoot(rawRoot: string): Promise<string> {
  if (typeof rawRoot !== "string" || rawRoot.trim().length === 0 || rawRoot.includes(NULL_BYTE)) {
    throw new LocalProjectRefreshError("INVALID_REPOSITORY_ROOT", "Repository root is invalid.");
  }
  let realRoot: string;
  try {
    realRoot = await fs.realpath(path.resolve(rawRoot));
    const stats = await fs.stat(realRoot);
    if (!stats.isDirectory()) throw new Error("not-directory");
  } catch {
    throw new LocalProjectRefreshError("INVALID_REPOSITORY_ROOT", "Repository root could not be resolved as an existing directory.");
  }
  return realRoot;
}

function toSafeReference(root: string, absolutePath: string): string | null {
  const relative = path.relative(root, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

async function walkMarkdownFiles(root: string, directorySegments: readonly string[], sourceKind: ProjectSourceKind) {
  const directory = path.join(root, ...directorySegments);
  try {
    const stats = await fs.stat(directory);
    if (!stats.isDirectory()) return [];
  } catch {
    return [];
  }

  const results: { reference: string; sourceKind: ProjectSourceKind }[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      throw new LocalProjectRefreshError("DOCUMENT_DISCOVERY_FAILURE", "Unable to discover repository documents.");
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const reference = toSafeReference(root, absolute);
        if (!reference) {
          throw new LocalProjectRefreshError("UNSAFE_DOCUMENT_PATH", "Discovered document reference was rejected.");
        }
        results.push({ reference, sourceKind });
      }
    }
  }
  await walk(directory);
  return results;
}

async function discoverRepositoryDocuments(root: string) {
  const results: { reference: string; sourceKind: ProjectSourceKind }[] = [];
  for (const file of ROOT_FILES) {
    try {
      const stats = await fs.stat(path.join(root, file.reference));
      if (stats.isFile()) results.push(file);
    } catch {
      // Optional allowlisted root documents are skipped when absent.
    }
  }
  for (const directory of DOCUMENT_DIRECTORIES) {
    results.push(...(await walkMarkdownFiles(root, directory.segments, directory.sourceKind)));
  }
  return results.sort((a, b) => a.reference.localeCompare(b.reference) || a.sourceKind.localeCompare(b.sourceKind));
}

function mapAdapterError(error: RepositoryDocumentAdapterError): LocalProjectRefreshError {
  if (error.code === "UNAUTHENTICATED") return new LocalProjectRefreshError("UNAUTHENTICATED", "Authentication is required.");
  if (error.code === "PROJECT_NOT_FOUND") return new LocalProjectRefreshError("PROJECT_NOT_FOUND", "Project was not found for this user.");
  if (error.code === "PROJECT_ARCHIVED") return new LocalProjectRefreshError("PROJECT_ARCHIVED", "Project is archived.");
  if (error.code === "SOURCE_KIND_NOT_ENABLED") return new LocalProjectRefreshError("EVIDENCE_SOURCE_DISABLED", "Repository document evidence is not enabled.");
  if (
    error.code === "PATH_REJECTED" ||
    error.code === "PATH_OUTSIDE_REPOSITORY_ROOT" ||
    error.code === "SOURCE_KIND_PATH_MISMATCH" ||
    error.code === "UNSUPPORTED_SOURCE_KIND"
  ) {
    return new LocalProjectRefreshError("UNSAFE_DOCUMENT_PATH", "Repository document reference was rejected.");
  }
  if (
    error.code === "FILE_NOT_FOUND" ||
    error.code === "UNSUPPORTED_FILE_TYPE" ||
    error.code === "INVALID_UTF8" ||
    error.code === "FILE_TOO_LARGE" ||
    error.code === "READ_FAILED" ||
    error.code === "CONTENT_CHANGED_DURING_ACQUISITION"
  ) {
    return new LocalProjectRefreshError("DOCUMENT_READ_FAILURE", "Repository document could not be read safely.");
  }
  return new LocalProjectRefreshError("EVIDENCE_PERSISTENCE_FAILURE", "Unable to persist project evidence.");
}

function countItemConflicts(brief: ProjectBrief): number {
  return brief.completedMilestones.filter((item) => item.conflictedWith && item.conflictedWith.length > 0).length;
}

function createFailureResult(input: {
  startedAt: string;
  failedAt: string;
  project?: { readonly id: string; readonly name: string };
  discoveredCount: number;
  documents: readonly LocalProjectRefreshDocumentResult[];
  failure: { readonly code: LocalProjectRefreshErrorCode; readonly message: string };
  projectBriefAttempted: boolean;
  projectBriefProduced: boolean;
}): LocalProjectRefreshFailureResult {
  const createdCount = input.documents.filter((item) => item.outcome === "created").length;
  const unchangedCount = input.documents.filter((item) => item.outcome === "unchanged").length;
  const skippedCount = input.documents.filter((item) => item.outcome === "skipped").length;
  const failedCount = input.documents.filter((item) => item.outcome === "failed").length;
  const partial = createdCount + unchangedCount > 0 || input.projectBriefAttempted;
  return {
    status: partial ? "failed_partial" : "failed",
    partial,
    ...(input.project ? { project: input.project } : {}),
    startedAt: input.startedAt,
    failedAt: input.failedAt,
    discoveredCount: input.discoveredCount,
    processedCount: input.documents.length,
    createdCount,
    unchangedCount,
    skippedCount,
    failedCount,
    documents: input.documents,
    failure: input.failure,
    projectBriefAttempted: input.projectBriefAttempted,
    projectBriefProduced: input.projectBriefProduced,
  };
}

export async function refreshLocalProject(
  input: { projectId: string; repositoryRoot: string },
  dependencies: LocalProjectRefreshDependencies,
): Promise<LocalProjectRefreshResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = now();

  const ownerId = await dependencies.resolveOwnerId();
  if (!ownerId) throw new LocalProjectRefreshError("UNAUTHENTICATED", "Authentication is required.");

  let project;
  try {
    project = await dependencies.projectRepository.findById(ownerId, input.projectId);
  } catch {
    throw new LocalProjectRefreshError("PROJECT_NOT_FOUND", "Project was not found for this user.");
  }
  if (!project) throw new LocalProjectRefreshError("PROJECT_NOT_FOUND", "Project was not found for this user.");
  if (project.status === "archived") throw new LocalProjectRefreshError("PROJECT_ARCHIVED", "Project is archived.");
  if (!REQUIRED_SOURCE_KINDS.every((kind) => project.enabledEvidenceSourceKinds.includes(kind))) {
    throw new LocalProjectRefreshError("EVIDENCE_SOURCE_DISABLED", "Repository document evidence is not fully enabled for this project.");
  }

  const trustedRoot = await resolveTrustedRepositoryRoot(input.repositoryRoot);
  const boundRoot = trustedRoot;
  const repositoryRootResolver: RepositoryRootResolver = () => boundRoot;
  const adapter =
    dependencies.repositoryDocumentAdapter ??
    createRepositoryDocumentAdapter({
      repositoryRoot: repositoryRootResolver,
      resolveOwnerId: dependencies.resolveOwnerId,
      projectRepository: dependencies.projectRepository,
      evidenceService: dependencies.evidenceService,
      now,
    });

  const discovered = await discoverRepositoryDocuments(trustedRoot);
  const documents: LocalProjectRefreshDocumentResult[] = [];
  for (const document of discovered) {
    try {
      const result = await adapter.ingestRepositoryDocument({
        projectId: input.projectId,
        sourceKind: document.sourceKind,
        relativePath: document.reference,
      });
      documents.push({
        reference: document.reference,
        sourceKind: document.sourceKind,
        outcome: result.outcome,
        evidenceId: result.evidence.id,
        contentHash: result.observation.contentHash,
      });
    } catch (error) {
      if (error instanceof RepositoryDocumentAdapterError) {
        documents.push({ ...document, outcome: "failed", reasonCode: error.code });
        const mapped = mapAdapterError(error);
        const failure = createFailureResult({
          startedAt,
          failedAt: now(),
          project: { id: project.id, name: project.name },
          discoveredCount: discovered.length,
          documents,
          failure: { code: mapped.code, message: mapped.message },
          projectBriefAttempted: false,
          projectBriefProduced: false,
        });
        throw new LocalProjectRefreshError(mapped.code, mapped.message, failure);
      }
      documents.push({ ...document, outcome: "failed", reasonCode: "UNEXPECTED" });
      const failure = createFailureResult({
        startedAt,
        failedAt: now(),
        project: { id: project.id, name: project.name },
        discoveredCount: discovered.length,
        documents,
        failure: { code: "UNEXPECTED_REFRESH_FAILURE", message: "Unexpected refresh failure." },
        projectBriefAttempted: false,
        projectBriefProduced: false,
      });
      throw new LocalProjectRefreshError("UNEXPECTED_REFRESH_FAILURE", "Unexpected refresh failure.", failure);
    }
  }

  const rebuild = await dependencies.contextRebuildService.rebuildProjectContext(input.projectId).catch((error) => {
    const code = error instanceof ProjectBriefError && error.code === "NO_SUPPORTED_BRIEF_CONTENT" ? "NO_SUPPORTED_BRIEF_CONTENT" : "SNAPSHOT_BRIEF_FAILURE";
    const message = code === "NO_SUPPORTED_BRIEF_CONTENT" ? "No supported brief content is available." : "Unable to build evidence snapshot for project brief.";
    throw new LocalProjectRefreshError(
      code,
      message,
      createFailureResult({
        startedAt,
        failedAt: now(),
        project: { id: project.id, name: project.name },
        discoveredCount: discovered.length,
        documents,
        failure: { code, message },
        projectBriefAttempted: true,
        projectBriefProduced: false,
      }),
    );
  });
  const briefResult = buildProjectBriefFromSnapshot(
    { id: rebuild.project.id, name: rebuild.project.name },
    rebuild.snapshot,
    now(),
  );
  if (briefResult.valid === false) {
    const noContent = briefResult.errors.some((issue) => issue.code === "NO_SUPPORTED_CONTENT");
    const code = noContent ? "NO_SUPPORTED_BRIEF_CONTENT" : "SNAPSHOT_BRIEF_FAILURE";
    const message = noContent ? "No supported brief content is available." : "Unable to build project brief.";
    throw new LocalProjectRefreshError(
      code,
      message,
      createFailureResult({
        startedAt,
        failedAt: now(),
        project: { id: project.id, name: project.name },
        discoveredCount: discovered.length,
        documents,
        failure: { code, message },
        projectBriefAttempted: true,
        projectBriefProduced: false,
      }),
    );
  }

  const completedAt = now();
  const counts = {
    discovered: documents.length,
    created: documents.filter((item) => item.outcome === "created").length,
    unchanged: documents.filter((item) => item.outcome === "unchanged").length,
    skipped: documents.filter((item) => item.outcome === "skipped").length,
    failed: documents.filter((item) => item.outcome === "failed").length,
  };

  return {
    status: "completed",
    partial: false,
    project: { id: project.id, name: project.name },
    startedAt,
    completedAt,
    counts,
    documents,
    snapshotHash: briefResult.brief.snapshotHash,
    projectBrief: briefResult.brief,
    extractionWarnings: briefResult.brief.extractionWarnings,
    conflicts: {
      currentPhase: briefResult.brief.currentPhase.status === "conflicted",
      currentFocus: briefResult.brief.currentFocus.status === "conflicted",
      itemConflictCount: countItemConflicts(briefResult.brief),
    },
    limitations: [
      "Local manual trusted-operator command only.",
      "No browser refresh button, hosted filesystem access, scheduler, semantic memory, LLM extraction, or Smart Automation.",
    ],
  };
}
