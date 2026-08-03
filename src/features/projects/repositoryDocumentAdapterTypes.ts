// SmartFlow -- Repository Documents Adapter.
//
// Shared types and typed failures for the adapter's public contract. No I/O,
// no validation logic -- see repositoryDocumentPathSecurity.ts (pure path
// rules) and repositoryDocumentFileReader.ts (the actual filesystem read).

import type { ProjectSourceKind } from "./projectContextTypes";
import type { ProjectEvidenceWithObservation } from "./projectEvidenceTypes";

/**
 * Resolves the trusted, absolute repository root. Deliberately a required,
 * injected dependency with no default implementation and no production
 * singleton in this slice: `project-evidence-acquisition.md` section 25
 * records "where repository-document adapters physically execute" as an
 * open architecture question (the browser cannot read a server's git
 * checkout), so this module defines only the smallest testable seam and
 * leaves wiring a concrete, trusted resolver to whatever future trusted
 * Node-side execution context invokes this adapter. Must never be derived
 * from browser input, a query parameter, localStorage, model output, or any
 * field of the ingest input or of `ProjectRecord`.
 */
export type RepositoryRootResolver = () => string;

export type RepositoryDocumentAdapterErrorCode =
  | "UNAUTHENTICATED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "SOURCE_KIND_NOT_ENABLED"
  | "UNSUPPORTED_SOURCE_KIND"
  | "PATH_REJECTED"
  | "SOURCE_KIND_PATH_MISMATCH"
  | "FILE_NOT_FOUND"
  | "PATH_OUTSIDE_REPOSITORY_ROOT"
  | "UNSUPPORTED_FILE_TYPE"
  | "INVALID_UTF8"
  | "FILE_TOO_LARGE"
  | "READ_FAILED"
  | "CONTENT_CHANGED_DURING_ACQUISITION"
  | "EVIDENCE_VALIDATION_FAILED"
  | "PERSISTENCE_FAILED";

/**
 * Every message on this type is written to never include an absolute
 * filesystem path, the repository root, or a raw Node/Postgres error --
 * see repositoryDocumentAdapter.ts's `toAdapterError` and each rejection
 * site for where that sanitization happens.
 */
export class RepositoryDocumentAdapterError extends Error {
  readonly code: RepositoryDocumentAdapterErrorCode;

  constructor(code: RepositoryDocumentAdapterErrorCode, message: string) {
    super(message);
    this.name = "RepositoryDocumentAdapterError";
    this.code = code;
  }
}

export interface IngestRepositoryDocumentInput {
  projectId: string;
  sourceKind: ProjectSourceKind;
  /** A repository-relative path, e.g. "docs/architecture/project-domain.md". Always untrusted -- validated against the fixed allowlist in repositoryDocumentPathSecurity.ts and never trusted as a raw filesystem path. */
  relativePath: string;
  acquisitionAttemptId?: string;
}

export type IngestRepositoryDocumentResult =
  | ({ outcome: "created" } & ProjectEvidenceWithObservation)
  | ({ outcome: "unchanged" } & ProjectEvidenceWithObservation);
