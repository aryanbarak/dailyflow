// SmartFlow -- Repository Documents Adapter.
//
// The first real, credential-free Evidence Source Adapter
// (docs/architecture/project-evidence-acquisition.md section 8): reads
// exactly one allowlisted, in-repo Markdown document and turns it into a
// validated ProjectEvidence record via the existing
// projectEvidenceService.ts. This module performs acquisition only -- it
// never interprets document meaning, never calls ProjectContextBuilder,
// never resolves an evidence conflict, and never grants execution
// authority. It is strictly read-only against the repository: no function
// here ever writes to, moves, or deletes a document.
//
// This module never writes directly through projectEvidenceRepository.ts
// and never bypasses projectEvidenceService.ts's own auth/project/archive/
// enabled-kind checks -- it duplicates a read-only, side-effect-free subset
// of those same checks locally (via the injected ownerId resolver and
// ProjectRecordRepository) only so that an unauthenticated caller, an
// unowned/missing project, an archived project, or a disabled source kind
// is rejected *before* any filesystem access happens, exactly as
// project-evidence-acquisition.md section 9's ordering requires. The
// service performs the identical checks again before persistence, as
// defense in depth -- the same pattern projectEvidenceService.ts's own RLS
// policy already applies to project ownership.

import { validateRepositoryDocumentPath } from "./repositoryDocumentPathSecurity";
import { readRepositoryDocument, readLocalGitRevision } from "./repositoryDocumentFileReader";
import {
  RepositoryDocumentAdapterError,
  type IngestRepositoryDocumentResult,
  type RepositoryDocumentAdapterErrorCode,
  type RepositoryRootResolver,
} from "./repositoryDocumentAdapterTypes";
import { ProjectEvidenceError, type ProjectEvidenceWithObservation } from "./projectEvidenceTypes";
import type { ProjectSourceKind } from "./projectContextTypes";
import {
  projectEvidenceService,
  type OwnerIdResolver,
  type ProjectEvidenceService,
} from "./projectEvidenceService";
import { projectRecordRepository, type ProjectRecordRepository } from "./projectRecordRepository";

/** Matches the identity already used in the Slice 4B RLS test fixtures for this exact future adapter -- kept as the real, stable value now that the adapter exists. */
export const REPOSITORY_DOCUMENT_ADAPTER_IDENTITY = "repository-document-adapter";
export const REPOSITORY_DOCUMENT_ADAPTER_VERSION = "1.0.0";
const VERIFICATION_METHOD = "deterministic file read";
/** Every allowlisted path is Markdown (repositoryDocumentPathSecurity.ts) -- this adapter never reads anything else, so the MIME type is fixed rather than sniffed or caller-supplied. */
const OBSERVATION_MIME_TYPE = "text/markdown";

export interface RepositoryDocumentAdapterDependencies {
  /** Trusted repository root. Required, with no default -- see RepositoryRootResolver's doc comment for why this slice does not invent one. */
  repositoryRoot: RepositoryRootResolver;
  /** Trusted owner-id resolution, mirroring projectEvidenceService.ts's own OwnerIdResolver contract exactly -- never derived from ingest input. */
  resolveOwnerId: OwnerIdResolver;
  projectRepository?: ProjectRecordRepository;
  evidenceService?: ProjectEvidenceService;
  /** Injected acquisition clock. Defaults to the system clock; tests inject a fixed value. */
  now?: () => string;
}

export interface RepositoryDocumentAdapter {
  ingestRepositoryDocument(input: unknown): Promise<IngestRepositoryDocumentResult>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reads exactly one top-level field via its property descriptor, never via
 * direct property access -- a throwing/accessor getter on any of this
 * input's four flat fields must surface as a typed PATH_REJECTED failure,
 * never as an uncaught exception. Unlike CreateProjectEvidenceInput, this
 * input shape has no nested objects to recurse into, so a full descriptor
 * tree walk (projectEvidenceValidation.ts's `scanForUnsafeValues`) is not
 * needed here -- only this narrow, flat guard is.
 */
function readSafeField(input: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return undefined;
  if ("get" in descriptor || "set" in descriptor) {
    throw new RepositoryDocumentAdapterError("PATH_REJECTED", "Ingest input is invalid.");
  }
  return descriptor.value;
}

function toAdapterError(error: unknown): RepositoryDocumentAdapterError {
  if (error instanceof RepositoryDocumentAdapterError) return error;
  if (error instanceof ProjectEvidenceError) {
    const mapped: Partial<Record<string, RepositoryDocumentAdapterErrorCode>> = {
      UNAUTHENTICATED: "UNAUTHENTICATED",
      PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
      PROJECT_ARCHIVED: "PROJECT_ARCHIVED",
      SOURCE_KIND_NOT_ENABLED: "SOURCE_KIND_NOT_ENABLED",
    };
    const code = mapped[error.code];
    if (code) return new RepositoryDocumentAdapterError(code, error.message);
    if (error.code === "DUPLICATE_EVIDENCE" || error.code === "INVALID_INPUT") {
      return new RepositoryDocumentAdapterError("EVIDENCE_VALIDATION_FAILED", "The evidence candidate was rejected.");
    }
    // PERSISTENCE_FAILED, NOT_FOUND, SUPERSEDED_EVIDENCE_NOT_FOUND: none of
    // these are reachable through this adapter's own candidate shape (it
    // never sets supersedesId), so they collapse to the generic, sanitized
    // persistence failure rather than leaking a service-internal code.
    return new RepositoryDocumentAdapterError("PERSISTENCE_FAILED", "Unable to persist project evidence.");
  }
  // A raw filesystem, network, or other untyped error must never escape
  // with its original message -- it may contain an absolute path.
  return new RepositoryDocumentAdapterError("PERSISTENCE_FAILED", "Unable to complete repository document acquisition.");
}

export function createRepositoryDocumentAdapter(
  dependencies: RepositoryDocumentAdapterDependencies,
): RepositoryDocumentAdapter {
  const { repositoryRoot, resolveOwnerId } = dependencies;
  const projectRepository = dependencies.projectRepository ?? projectRecordRepository;
  const evidenceService = dependencies.evidenceService ?? projectEvidenceService;
  const now = dependencies.now ?? (() => new Date().toISOString());

  return {
    async ingestRepositoryDocument(rawInput: unknown): Promise<IngestRepositoryDocumentResult> {
      if (!isPlainObject(rawInput)) {
        throw new RepositoryDocumentAdapterError("PATH_REJECTED", "Ingest input is invalid.");
      }
      const projectIdValue = readSafeField(rawInput, "projectId");
      const sourceKindValue = readSafeField(rawInput, "sourceKind");
      const relativePathValue = readSafeField(rawInput, "relativePath");
      const acquisitionAttemptIdValue = readSafeField(rawInput, "acquisitionAttemptId");

      if (typeof projectIdValue !== "string" || projectIdValue.trim().length === 0) {
        throw new RepositoryDocumentAdapterError("PATH_REJECTED", "A project id is required.");
      }
      if (typeof sourceKindValue !== "string") {
        throw new RepositoryDocumentAdapterError("UNSUPPORTED_SOURCE_KIND", "A source kind is required.");
      }
      if (
        acquisitionAttemptIdValue !== undefined &&
        (typeof acquisitionAttemptIdValue !== "string" || acquisitionAttemptIdValue.trim().length === 0)
      ) {
        throw new RepositoryDocumentAdapterError("PATH_REJECTED", "acquisitionAttemptId must be a non-empty string.");
      }
      const projectId = projectIdValue;
      const sourceKind = sourceKindValue as ProjectSourceKind;
      const acquisitionAttemptId = acquisitionAttemptIdValue as string | undefined;

      // Steps 1-5: trusted owner resolution, then owned/active/enabled
      // project checks -- all before any filesystem access. Non-disclosure
      // mirrors projectEvidenceService.ts exactly: a missing project and a
      // cross-user project produce the identical PROJECT_NOT_FOUND failure.
      const ownerId = await resolveOwnerId();
      if (!ownerId) {
        throw new RepositoryDocumentAdapterError(
          "UNAUTHENTICATED",
          "You must be signed in to ingest repository documents.",
        );
      }

      let project;
      try {
        project = await projectRepository.findById(ownerId, projectId);
      } catch {
        throw new RepositoryDocumentAdapterError("PROJECT_NOT_FOUND", "Project was not found for this user.");
      }
      if (!project) {
        throw new RepositoryDocumentAdapterError("PROJECT_NOT_FOUND", "Project was not found for this user.");
      }
      if (project.status === "archived") {
        throw new RepositoryDocumentAdapterError(
          "PROJECT_ARCHIVED",
          "Cannot ingest repository document evidence for an archived project.",
        );
      }
      if (!project.enabledEvidenceSourceKinds.includes(sourceKind)) {
        throw new RepositoryDocumentAdapterError(
          "SOURCE_KIND_NOT_ENABLED",
          "This evidence source kind is not enabled on the project's configuration.",
        );
      }

      // Step 6: validate the relative path and source-kind/path
      // relationship -- pure, no I/O, cannot itself confirm the file exists
      // or stays inside the repository root.
      const pathResult = validateRepositoryDocumentPath(sourceKind, relativePathValue);
      if (pathResult.safe === false) {
        if (pathResult.reason === "UNSUPPORTED_SOURCE_KIND") {
          throw new RepositoryDocumentAdapterError(
            "UNSUPPORTED_SOURCE_KIND",
            "This source kind cannot be produced by the repository document adapter.",
          );
        }
        if (pathResult.reason === "SOURCE_KIND_MISMATCH") {
          throw new RepositoryDocumentAdapterError(
            "SOURCE_KIND_PATH_MISMATCH",
            "The requested source kind does not match the allowlisted kind for this path.",
          );
        }
        throw new RepositoryDocumentAdapterError("PATH_REJECTED", "The requested document reference was rejected.");
      }
      const relativePath = pathResult.relativePath;

      // Steps 7-10: resolve the trusted root, securely resolve and read
      // bounded UTF-8 content, compute the SHA-256 content hash.
      const root = repositoryRoot();
      const readResult = await readRepositoryDocument(root, relativePath);
      if (readResult.ok === false) {
        throw new RepositoryDocumentAdapterError(readResult.reason, "The requested document could not be read.");
      }

      // Duplication/no-change semantics (Slice-local, deliberately narrow):
      // an unchanged file for the same project/source-kind/reference never
      // creates a new evidence row merely because wall-clock time advanced
      // -- only a genuinely different content hash, or a new reference,
      // does. The prior record is never overwritten; this simply declines
      // to create a duplicate and returns the existing pair instead. This
      // is an optimization only -- it avoids an unnecessary read+hash+RPC
      // round trip for the common re-acquisition case -- not the source of
      // correctness: the atomic create_project_evidence_with_observation
      // transaction's own content-hash-based candidate fingerprint (ADR-0007)
      // is what actually guarantees no duplicate pair can ever be created,
      // including under concurrent acquisition this pre-check cannot see.
      // See repositoryDocumentAdapter.test.ts for the exact behavior
      // asserted, including the case where this pre-check misses a
      // concurrent duplicate and the service's own "unchanged" outcome is
      // what actually prevents it.
      let existingForProject: readonly ProjectEvidenceWithObservation[];
      try {
        existingForProject = await evidenceService.listByProject(projectId);
      } catch (error) {
        throw toAdapterError(error);
      }
      const priorForReference = existingForProject
        .filter((pair) => pair.evidence.sourceKind === sourceKind && pair.evidence.reference === relativePath)
        .sort((a, b) => (a.evidence.collectedAt < b.evidence.collectedAt ? 1 : a.evidence.collectedAt > b.evidence.collectedAt ? -1 : 0))[0];
      if (priorForReference && priorForReference.observation.contentHash === readResult.contentHashHex) {
        return { outcome: "unchanged", evidence: priorForReference.evidence, observation: priorForReference.observation };
      }

      const gitRevision = await readLocalGitRevision(root);
      // Non-fatal decode: readRepositoryDocument has already proven these
      // bytes decode as valid UTF-8 (fatal:true) before computing the hash
      // above -- this is only turning the already-validated bytes into the
      // string form projectEvidenceService.ts's observation payload expects.
      const textContent = new TextDecoder("utf-8").decode(readResult.contentBytes);

      const candidate: Record<string, unknown> = {
        projectId,
        sourceKind,
        classification: "canonical_document_observation",
        // Deliberately the exact allowlisted relative path, never a title
        // parsed or inferred from document content or headings -- this
        // adapter performs acquisition only and must not interpret meaning.
        title: relativePath,
        reference: relativePath,
        collectedAt: now(),
        adapterIdentity: REPOSITORY_DOCUMENT_ADAPTER_IDENTITY,
        adapterVersion: REPOSITORY_DOCUMENT_ADAPTER_VERSION,
        verificationMethod: VERIFICATION_METHOD,
        // The consumable payload and its mandatory content hash both live
        // on ProjectEvidenceObservation (ADR-0007) -- byteLength and
        // contentHash are computed server-side
        // (projectEvidenceObservationValidation.ts /
        // projectEvidenceRepository.ts) from textContent itself, never
        // trusted from this adapter, even though the adapter also computed
        // its own copy above purely for the pre-check optimization.
        observation: {
          textContent,
          mimeType: OBSERVATION_MIME_TYPE,
          ...(gitRevision ? { gitRevision } : {}),
        },
      };
      if (acquisitionAttemptId !== undefined) {
        candidate.acquisitionAttemptId = acquisitionAttemptId;
      }

      try {
        return await evidenceService.create(candidate);
      } catch (error) {
        throw toAdapterError(error);
      }
    },
  };
}
