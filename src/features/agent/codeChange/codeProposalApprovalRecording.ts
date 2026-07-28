// EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
// The step between a browser-side approve decision (approvalInteraction.ts)
// and the mutation write path (writeRuntime.ts / github.files.update): calls
// the Worker's approval-recording route so a server-verifiable artifact
// exists before any mutation attempt is possible. approvalInteraction.ts
// itself stays a pure, synchronous function -- this is a separate,
// explicitly invoked step, not a change to that boundary. Not wired to any
// UI, chat, or reasoning surface yet.

import type { CodeProposalApprovalClient } from "../../integrations/github/codeProposalApprovalClient";
import type { WorkspaceStepApproval } from "../../workspace/workspaceTypes";

export type ConfirmCodeProposalApprovalStatus = "confirmed" | "not_applicable" | "failed";

export interface ConfirmCodeProposalApprovalInput {
  approval: WorkspaceStepApproval;
  proposedContent: string;
  client: CodeProposalApprovalClient;
}

export interface ConfirmCodeProposalApprovalResult {
  status: ConfirmCodeProposalApprovalStatus;
  proposalId?: string;
  expiresAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

// "not_applicable" for any approval that is not an approved code proposal
// (no codeProposalBinding, or status is not "approved") -- this is not an
// error, there is simply nothing for this step to record.
export async function confirmCodeProposalApproval(
  input: ConfirmCodeProposalApprovalInput,
): Promise<ConfirmCodeProposalApprovalResult> {
  const { approval, proposedContent, client } = input;
  if (approval.status !== "approved" || !approval.codeProposalBinding) {
    return { status: "not_applicable" };
  }

  const binding = approval.codeProposalBinding;
  try {
    const recorded = await client.recordApproval({
      proposalId: binding.proposalId,
      repo: binding.repo,
      path: binding.path,
      proposedContent,
    });
    return { status: "confirmed", proposalId: recorded.proposalId, expiresAt: recorded.expiresAt };
  } catch (caught) {
    const error = caught as Partial<{ code: string; message: string }>;
    return {
      status: "failed",
      errorCode: typeof error.code === "string" ? error.code : "APPROVAL_RECORD_FAILED",
      errorMessage: typeof error.message === "string" ? error.message : "The proposal could not be approved safely.",
    };
  }
}
