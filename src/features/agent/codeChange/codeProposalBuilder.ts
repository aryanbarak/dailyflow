// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// Builds a deterministic, validator-sanitized code-change proposal from an
// authenticated file read plus proposed content. No network access, no
// mutation -- this only ever produces a proposal and its approval preview.

import { generateUnifiedDiff } from "./codeDiff";
import { validateCodeFileProposalInput } from "./codeProposalValidator";
import type {
  CodeApprovalPreview,
  CodeFileProposal,
  CodeFileReadResult,
  CodeProposalBuildResult,
  StaleBaseCheckResult,
  StaleBaseReason,
} from "./codeProposalTypes";

export interface BuildCodeFileProposalInput {
  baseRead: CodeFileReadResult;
  proposedContent: string;
  requestId: string;
  stepId: string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// SHA-256 of the exact UTF-8 bytes of the given content. This is SmartFlow's
// own content-integrity digest -- distinct from GitHub's blob SHA (a
// git-object hash SmartFlow never recomputes, only carries through as given).
export async function computeContentDigest(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

// EPIC-08 Slice 2 -- a content-addressed proposal identity: the same
// repo/path/base/proposed-content combination always yields the same id, and
// any change to any one of them yields a different id. This is what an
// approval's codeProposalBinding pins, so re-approving after the underlying
// proposal changed in any way is detectable as a proposal id mismatch,
// without needing a separately tracked random identifier.
export async function computeProposalId(
  proposal: Pick<CodeFileProposal, "repo" | "path" | "baseBlobSha" | "baseCommitSha" | "proposedContentDigest">,
): Promise<string> {
  const canonical = [
    proposal.repo,
    proposal.path,
    proposal.baseBlobSha,
    proposal.baseCommitSha,
    proposal.proposedContentDigest,
  ].join("\n");
  return `code-proposal:${await computeContentDigest(canonical)}`;
}

export async function buildCodeFileProposal(
  input: BuildCodeFileProposalInput,
): Promise<CodeProposalBuildResult> {
  const validation = validateCodeFileProposalInput({
    repo: input.baseRead.repo,
    path: input.baseRead.path,
    baseContent: input.baseRead.content,
    proposedContent: input.proposedContent,
    operationCount: 1,
  });
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  if (!input.requestId?.trim() || !input.stepId?.trim()) {
    return { ok: false, errors: ["requestId and stepId are required."] };
  }

  const [baseContentDigest, proposedContentDigest] = await Promise.all([
    computeContentDigest(input.baseRead.content),
    computeContentDigest(input.proposedContent),
  ]);

  const diff = generateUnifiedDiff(input.baseRead.content, input.proposedContent, input.baseRead.path);

  const proposalId = await computeProposalId({
    repo: input.baseRead.repo,
    path: input.baseRead.path,
    baseBlobSha: input.baseRead.blobSha,
    baseCommitSha: input.baseRead.commitSha,
    proposedContentDigest,
  });

  const proposal: CodeFileProposal = {
    proposalId,
    repo: input.baseRead.repo,
    path: input.baseRead.path,
    baseBranch: input.baseRead.branch,
    baseCommitSha: input.baseRead.commitSha,
    baseBlobSha: input.baseRead.blobSha,
    baseContentDigest,
    proposedContent: input.proposedContent,
    proposedContentDigest,
    diff,
    operationCount: 1,
    requestId: input.requestId,
    stepId: input.stepId,
  };

  return { ok: true, proposal };
}

// Fails closed: any mismatch between what was proposed and what a fresh read
// now reports is "stale", full stop -- no partial trust, no silent rebase.
export async function checkStaleBase(
  proposal: CodeFileProposal,
  freshRead: CodeFileReadResult,
): Promise<StaleBaseCheckResult> {
  const reasons: StaleBaseReason[] = [];
  if (freshRead.blobSha !== proposal.baseBlobSha) reasons.push("blob_sha_changed");
  if (freshRead.commitSha !== proposal.baseCommitSha) reasons.push("commit_sha_changed");
  const freshDigest = await computeContentDigest(freshRead.content);
  if (freshDigest !== proposal.baseContentDigest) reasons.push("content_digest_changed");
  return { stale: reasons.length > 0, reasons };
}

// EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
// Building and previewing a proposal is still read-only by itself -- these
// statements describe THIS step, not whether a mutation capability exists
// anywhere in the system (it now does: github.files.update). Committing the
// change requires a separate, explicit approval-recording call and a
// separate, explicit Run through the write boundary; neither happens here.
const EXECUTION_SCOPE_STATEMENT =
  "Building and previewing this proposal only reads and diffs this one file. It cannot create a branch, " +
  "cannot create a commit, and cannot open a pull request by itself -- committing this change requires a " +
  "separate, explicit approval and Run through the write boundary.";

const RISK_STATEMENT =
  "No GitHub state changes as a result of building or viewing this proposal. A separate, explicit approval " +
  "and Run action is required before any branch or commit is created.";

function formatDiffStatsLine(proposal: CodeFileProposal): string {
  return `+${proposal.diff.addedLineCount} / -${proposal.diff.removedLineCount} lines`;
}

export function buildApprovalPreview(proposal: CodeFileProposal): CodeApprovalPreview {
  const header = [
    `Repository: ${proposal.repo}`,
    `Path: ${proposal.path}`,
    `Branch: ${proposal.baseBranch}`,
    `Base commit: ${proposal.baseCommitSha}`,
    `Base blob: ${proposal.baseBlobSha}`,
    formatDiffStatsLine(proposal),
  ].join("\n");

  const diffText = proposal.diff.isNoop
    ? "(no changes -- proposed content is identical to the current file)"
    : proposal.diff.text;

  return {
    previewText: `${header}\n\n${diffText}`,
    diffText,
    addedLineCount: proposal.diff.addedLineCount,
    removedLineCount: proposal.diff.removedLineCount,
    executionScope: EXECUTION_SCOPE_STATEMENT,
    riskStatement: RISK_STATEMENT,
  };
}
