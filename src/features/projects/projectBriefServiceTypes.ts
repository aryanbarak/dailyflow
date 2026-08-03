// SmartFlow -- Project Brief Foundation.
//
// The service boundary's typed error contract. `MALFORMED_EVIDENCE_PAYLOAD`,
// `UNSUPPORTED_DOCUMENT_SHAPE`, `EXTRACTOR_FAILED`, and
// `CONFLICTING_CANONICAL_STATEMENT` -- all named in this slice's brief --
// are deliberately NOT top-level thrown error codes here. Each is a
// per-item, recoverable condition (one document not matching an expected
// shape does not invalidate every other document's extractable content),
// so each is instead a typed `ProjectBriefExtractionWarning` entry
// (projectBriefTypes.ts) attached to an otherwise-successful brief -- "the
// document was ignored/its claim was preserved as a conflict, with a typed
// reason," never a silent drop and never an operation-ending exception for
// a condition that is not fatal to the whole rebuild.

export type ProjectBriefErrorCode =
  | "UNAUTHENTICATED"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "SNAPSHOT_UNAVAILABLE"
  | "NO_SUPPORTED_BRIEF_CONTENT"
  | "BRIEF_VALIDATION_FAILED"
  | "REBUILD_FAILED";

export interface ProjectBriefErrorIssue {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export class ProjectBriefError extends Error {
  readonly code: ProjectBriefErrorCode;
  readonly issues?: readonly ProjectBriefErrorIssue[];

  constructor(code: ProjectBriefErrorCode, message: string, issues?: readonly ProjectBriefErrorIssue[]) {
    super(message);
    this.name = "ProjectBriefError";
    this.code = code;
    this.issues = issues;
  }
}
