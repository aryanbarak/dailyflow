// SmartFlow -- ProjectEvidence Observation Foundation (ADR-0007).
//
// ProjectEvidenceObservation is the immutable, 1:1 aggregate that owns the
// consumable observation payload ProjectEvidence itself deliberately does
// not (docs/decisions/adr/ADR-0007-projectevidence-observation-model.md).
// This module defines the domain shape only -- no I/O, no validation logic,
// no persistence.
//
// It is not ProjectContext, not interpretation, not execution authority,
// and not memory truth: it states what a source's content was, never what
// it means.

/** Closed to "text" only in this implementation. Widening this is a future migration and a future ADR, not a silent runtime default. */
export const PROJECT_EVIDENCE_OBSERVATION_PAYLOAD_KINDS = ["text"] as const;
export type ProjectEvidenceObservationPayloadKind = (typeof PROJECT_EVIDENCE_OBSERVATION_PAYLOAD_KINDS)[number];

/** MIME types this implementation accepts for a text payload -- the exact set the Repository Documents Adapter's Markdown-only allowlist can ever produce. */
export const PROJECT_EVIDENCE_OBSERVATION_TEXT_MIME_TYPES = ["text/markdown", "text/plain"] as const;
export type ProjectEvidenceObservationTextMimeType = (typeof PROJECT_EVIDENCE_OBSERVATION_TEXT_MIME_TYPES)[number];

/** Matches the database CHECK constraint exactly (project_evidence_observations.byte_length). */
export const MAX_TEXT_OBSERVATION_BYTES = 512 * 1024;

/**
 * The immutable, consumable payload for one ProjectEvidence record. Every
 * field here has a stated need per ADR-0007 -- no structured payload
 * ("structured_content"), no artifact/blob reference, no mutable parser
 * output, no ProjectContext field, no approval/execution field, no
 * credential, and no generic/untyped "content" field.
 */
export interface ProjectEvidenceObservation {
  id: string;
  evidenceId: string;
  projectId: string;
  ownerId: string;
  payloadKind: "text";
  /** The exact normalized UTF-8 text whose bytes `contentHash` covers. Never transformed, summarized, or otherwise interpreted beyond deterministic UTF-8 decoding. */
  textContent: string;
  mimeType: ProjectEvidenceObservationTextMimeType;
  /** The exact encoded UTF-8 byte length of `textContent` -- always server-computed, never trusted from a caller. */
  byteLength: number;
  /** SHA-256, lowercase hex, over the exact UTF-8 bytes of `textContent` -- always server-computed, never trusted from a caller. */
  contentHash: string;
  /** Structured provenance only -- never embedded in free text. A 40-character lowercase hex Git commit SHA, when the acquiring adapter ran against a Git checkout. */
  gitRevision?: string;
  createdAt: string;
}

/**
 * Input for the text payload half of an atomic create. `byteLength` and
 * `contentHash` are deliberately absent: both are always computed
 * server-side from `textContent` itself (projectEvidenceObservationValidation.ts),
 * never accepted as caller-supplied derived metadata.
 */
export interface CreateProjectEvidenceObservationTextInput {
  textContent: string;
  mimeType: ProjectEvidenceObservationTextMimeType;
  gitRevision?: string;
}

/**
 * A shape-validated text observation input: the exact `textContent` and
 * `mimeType` to persist, a server-computed `byteLength` (the encoded UTF-8
 * byte length, always derived from `textContent` itself -- byte-length
 * computation is synchronous, so this is done here), and a
 * format-validated `gitRevision`. Deliberately does not include
 * `contentHash`: computing a SHA-256 digest is asynchronous
 * (`globalThis.crypto.subtle.digest`), so that step happens one layer up,
 * immediately before persistence (`projectEvidenceRepository.ts`), mirroring
 * exactly how `candidate_fingerprint` is already computed there today.
 */
export interface ValidatedProjectEvidenceObservationTextInput {
  payloadKind: "text";
  textContent: string;
  mimeType: ProjectEvidenceObservationTextMimeType;
  byteLength: number;
  gitRevision?: string;
}

export type ProjectEvidenceObservationValidationErrorCode =
  | "UNSAFE_VALUE"
  | "UNKNOWN_FIELD"
  | "MISSING_TEXT_CONTENT"
  | "EMPTY_TEXT_CONTENT"
  | "TEXT_CONTENT_TOO_LARGE"
  | "INVALID_UTF8_TEXT_CONTENT"
  | "UNSUPPORTED_MIME_TYPE"
  | "INVALID_GIT_REVISION";

export interface ProjectEvidenceObservationValidationIssue {
  code: ProjectEvidenceObservationValidationErrorCode;
  message: string;
  path?: string;
}

export type ProjectEvidenceObservationValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; errors: readonly ProjectEvidenceObservationValidationIssue[] };
