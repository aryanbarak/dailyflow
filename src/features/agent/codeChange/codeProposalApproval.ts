// EPIC-08 Slice 2 -- see docs/roadmap/epic-08-write-code-design-v1.md, section
// 10 (Approval Boundary) and section 19 (Slice 2 - Code Approval and
// Write-Runtime Contract).
//
// This module builds the exact approval binding for a code-change proposal
// and validates that binding against whatever proposal is "current" at the
// moment execution would occur. It does not execute anything: EPIC-08 has no
// registered code-write tool and no write handler yet (Slice 3). This is the
// deterministic contract Slice 3's write handler will call before it is
// allowed to touch GitHub.

import type { WorkspaceCodeProposalBinding } from "../../workspace/workspaceTypes";
import type { CodeFileProposal } from "./codeProposalTypes";

// Design doc section 10: "Approval expires after 15 minutes or when the
// current base blob SHA differs from the proposal, whichever comes first."
export const CODE_PROPOSAL_APPROVAL_TTL_MS = 15 * 60 * 1000;

export type CodeProposalApprovalRejectionReason =
  | "proposal_id_mismatch"
  | "blob_sha_mismatch"
  | "commit_sha_mismatch"
  | "content_digest_mismatch"
  | "approval_expired";

export interface CodeProposalApprovalCheckResult {
  valid: boolean;
  reasons: CodeProposalApprovalRejectionReason[];
}

// Builds the exact binding an approval is pinned to. Called once, at the
// moment the proposal is presented for approval -- never recomputed from a
// later, possibly different proposal.
export function buildCodeProposalBinding(
  proposal: Pick<
    CodeFileProposal,
    "proposalId" | "repo" | "path" | "baseBlobSha" | "baseCommitSha" | "proposedContentDigest"
  >,
  currentTime: Date,
): WorkspaceCodeProposalBinding {
  return {
    repo: proposal.repo,
    path: proposal.path,
    baseBlobSha: proposal.baseBlobSha,
    baseCommitSha: proposal.baseCommitSha,
    proposedContentDigest: proposal.proposedContentDigest,
    proposalId: proposal.proposalId,
    expiresAt: new Date(currentTime.getTime() + CODE_PROPOSAL_APPROVAL_TTL_MS).toISOString(),
  };
}

export interface ValidateCodeProposalApprovalInput {
  binding: WorkspaceCodeProposalBinding;
  // The proposal to validate the binding against. In Slice 3 this will be a
  // freshly rebuilt proposal from a fresh GitHub read (the actual
  // stale-base check); in an immediate re-validation it may be the same
  // proposal object the binding was built from.
  proposal: Pick<
    CodeFileProposal,
    "proposalId" | "baseBlobSha" | "baseCommitSha" | "proposedContentDigest"
  >;
  currentTime: Date;
}

// Fails closed: every reason is checked independently and all are reported,
// mirroring codeProposalBuilder.ts's checkStaleBase -- a caller-facing error
// message can then say exactly what changed (content vs. upstream file vs.
// simply expired) rather than a single opaque "invalid".
export function validateCodeProposalApproval(
  input: ValidateCodeProposalApprovalInput,
): CodeProposalApprovalCheckResult {
  const { binding, proposal, currentTime } = input;
  const reasons: CodeProposalApprovalRejectionReason[] = [];

  if (binding.proposalId !== proposal.proposalId) reasons.push("proposal_id_mismatch");
  if (binding.baseBlobSha !== proposal.baseBlobSha) reasons.push("blob_sha_mismatch");
  if (binding.baseCommitSha !== proposal.baseCommitSha) reasons.push("commit_sha_mismatch");
  if (binding.proposedContentDigest !== proposal.proposedContentDigest) reasons.push("content_digest_mismatch");
  if (currentTime.getTime() > new Date(binding.expiresAt).getTime()) reasons.push("approval_expired");

  return { valid: reasons.length === 0, reasons };
}
