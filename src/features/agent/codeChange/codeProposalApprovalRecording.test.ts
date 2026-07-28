import { describe, expect, it, vi } from "vitest";
import { confirmCodeProposalApproval } from "./codeProposalApprovalRecording";
import type { CodeProposalApprovalClient } from "../../integrations/github/codeProposalApprovalClient";
import type { WorkspaceStepApproval } from "../../workspace/workspaceTypes";

function approvedCodeStepApproval(overrides: Partial<WorkspaceStepApproval> = {}): WorkspaceStepApproval {
  return {
    stepId: "step:code-file-read",
    targetId: "aryan/smartflow:README.md",
    toolId: "github.files.update",
    status: "approved",
    requiresApproval: true,
    approvalReason: "Proposes a change to an existing repository file.",
    riskLevel: "high",
    reversible: false,
    externalEffect: true,
    dataDomains: ["github"],
    approvalScope: "single_step",
    codeProposalBinding: {
      repo: "aryan/smartflow",
      path: "README.md",
      baseBlobSha: "blob-sha-1",
      baseCommitSha: "commit-sha-1",
      proposedContentDigest: "a".repeat(64),
      proposalId: `code-proposal:${"b".repeat(64)}`,
      expiresAt: "2026-07-28T10:15:00.000Z",
    },
    ...overrides,
  };
}

describe("confirmCodeProposalApproval", () => {
  it("records the approval using exactly the binding's proposalId/repo/path plus the given proposed content", async () => {
    const recordApproval = vi.fn(async () => ({
      proposalId: `code-proposal:${"b".repeat(64)}`,
      expiresAt: "2026-07-28T10:15:00.000Z",
    }));
    const client: CodeProposalApprovalClient = { recordApproval };

    const result = await confirmCodeProposalApproval({
      approval: approvedCodeStepApproval(),
      proposedContent: "hello world\n",
      client,
    });

    expect(recordApproval).toHaveBeenCalledWith({
      proposalId: `code-proposal:${"b".repeat(64)}`,
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
    });
    expect(result).toEqual({
      status: "confirmed",
      proposalId: `code-proposal:${"b".repeat(64)}`,
      expiresAt: "2026-07-28T10:15:00.000Z",
    });
  });

  it("is not_applicable for an approval with no codeProposalBinding (e.g. tasks.complete)", async () => {
    const recordApproval = vi.fn();
    const approval = approvedCodeStepApproval();
    delete (approval as { codeProposalBinding?: unknown }).codeProposalBinding;

    const result = await confirmCodeProposalApproval({ approval, proposedContent: "x", client: { recordApproval } });

    expect(result).toEqual({ status: "not_applicable" });
    expect(recordApproval).not.toHaveBeenCalled();
  });

  it("is not_applicable for a pending or rejected approval, even if it carries a binding", async () => {
    const recordApproval = vi.fn();
    const pending = await confirmCodeProposalApproval({
      approval: approvedCodeStepApproval({ status: "pending" }),
      proposedContent: "x",
      client: { recordApproval },
    });
    const rejected = await confirmCodeProposalApproval({
      approval: approvedCodeStepApproval({ status: "rejected" }),
      proposedContent: "x",
      client: { recordApproval },
    });

    expect(pending).toEqual({ status: "not_applicable" });
    expect(rejected).toEqual({ status: "not_applicable" });
    expect(recordApproval).not.toHaveBeenCalled();
  });

  it("returns a typed failed result, surfacing the client's error code, without throwing", async () => {
    const client: CodeProposalApprovalClient = {
      recordApproval: vi.fn(async () => {
        throw { code: "STALE_BASE", message: "The file has changed since it was approved." };
      }),
    };

    const result = await confirmCodeProposalApproval({
      approval: approvedCodeStepApproval(),
      proposedContent: "hello world\n",
      client,
    });

    expect(result).toEqual({
      status: "failed",
      errorCode: "STALE_BASE",
      errorMessage: "The file has changed since it was approved.",
    });
  });

  it("falls back to a generic error code when the thrown error is not shaped as expected", async () => {
    const client: CodeProposalApprovalClient = {
      recordApproval: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    const result = await confirmCodeProposalApproval({
      approval: approvedCodeStepApproval(),
      proposedContent: "hello world\n",
      client,
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("APPROVAL_RECORD_FAILED");
  });
});
