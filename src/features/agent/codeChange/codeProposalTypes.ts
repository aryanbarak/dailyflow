// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// Read-only vertical slice: authenticated file read, deterministic proposal,
// diff, and stale-base detection. No branch, commit, or mutation exists yet.

export interface CodeFileReadResult {
  repo: string;
  path: string;
  branch: string;
  blobSha: string;
  commitSha: string;
  content: string;
  size: number;
}

export interface CodeProposalValidationResult {
  valid: boolean;
  errors: string[];
}

export interface UnifiedDiffLine {
  type: "context" | "added" | "removed";
  content: string;
}

export interface UnifiedDiffHunk {
  originalStart: number;
  originalLines: number;
  proposedStart: number;
  proposedLines: number;
  lines: UnifiedDiffLine[];
}

export interface UnifiedDiffResult {
  path: string;
  hunks: UnifiedDiffHunk[];
  addedLineCount: number;
  removedLineCount: number;
  isNoop: boolean;
  text: string;
}

export interface CodeFileProposal {
  // EPIC-08 Slice 2 -- content-addressed identity of this exact proposal
  // (repo + path + baseBlobSha + baseCommitSha + proposedContentDigest).
  // See codeProposalBuilder.ts's computeProposalId.
  proposalId: string;
  repo: string;
  path: string;
  baseBranch: string;
  baseCommitSha: string;
  baseBlobSha: string;
  baseContentDigest: string;
  proposedContent: string;
  proposedContentDigest: string;
  diff: UnifiedDiffResult;
  operationCount: 1;
  requestId: string;
  stepId: string;
}

export interface CodeProposalBuildSuccess {
  ok: true;
  proposal: CodeFileProposal;
}

export interface CodeProposalBuildFailure {
  ok: false;
  errors: string[];
}

export type CodeProposalBuildResult = CodeProposalBuildSuccess | CodeProposalBuildFailure;

export type StaleBaseReason =
  | "blob_sha_changed"
  | "commit_sha_changed"
  | "content_digest_changed";

export interface StaleBaseCheckResult {
  stale: boolean;
  reasons: StaleBaseReason[];
}

export interface CodeApprovalPreview {
  previewText: string;
  diffText: string;
  addedLineCount: number;
  removedLineCount: number;
  executionScope: string;
  riskStatement: string;
}
