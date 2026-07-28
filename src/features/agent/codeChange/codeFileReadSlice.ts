// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
// Vertical slice: authenticated read (via the existing Tool Registry /
// Execution Policy / Execution Audit path) -> deterministic proposal -> diff
// -> approval-preview data bound to one existing Approval Interaction shape.
//
// As of EPIC-08 Slice 3 (see docs/adr/ADR-0005-code-write-mutation-boundary.md),
// "github.files.update" IS registered, with a real write handler
// (handlers/githubFilesUpdateHandler.ts) and Worker mutation route. This
// module's own scope is unchanged -- it only builds the read-side proposal
// and the pending approval a reviewer would see; it still never executes a
// mutation itself. Actually running the mutation additionally requires the
// Slice 3 server-verifiable approval record (agent_code_proposal_approvals),
// which this module does not create -- see codeProposalApprovalRecording.ts.

import { executeAgentTool } from "../executionEngine";
import { buildCodeProposalBinding } from "./codeProposalApproval";
import { buildApprovalPreview, buildCodeFileProposal } from "./codeProposalBuilder";
import type {
  ExecutionContext,
  ExecutionEngineDependencies,
  ExecutionResult,
  GitHubFileContentFile,
} from "../executionTypes";
import type {
  CodeApprovalPreview,
  CodeFileProposal,
  CodeFileReadResult,
} from "./codeProposalTypes";
import type { WorkspacePlanStep, WorkspaceStepApproval } from "../../workspace/workspaceTypes";

// The write tool this proposal is *for*. See tools/githubTools.ts for its
// registration (riskLevel: "high") and handlers/githubFilesUpdateHandler.ts
// for its handler.
export const CODE_WRITE_TOOL_ID = "github.files.update";

export type RequestCodeFileProposalStatus =
  | "proposed"
  | "not_connected"
  | "read_failed"
  | "validation_failed";

export interface RequestCodeFileProposalInput {
  requestId: string;
  step: WorkspacePlanStep;
  repo: string;
  path: string;
  proposedContent: string;
  executionContext?: ExecutionContext;
  currentTime?: Date;
}

export interface RequestCodeFileProposalResult {
  status: RequestCodeFileProposalStatus;
  readExecutionResult: ExecutionResult;
  proposal?: CodeFileProposal;
  preview?: CodeApprovalPreview;
  approval?: WorkspaceStepApproval;
  errors: string[];
}

function readStep(step: WorkspacePlanStep, repo: string, path: string): WorkspacePlanStep {
  return {
    ...step,
    domain: "github",
    actionType: "inspect",
    targetId: `${repo}:${path}`,
    requiresApproval: false,
  };
}

function toCodeFileReadResult(file: GitHubFileContentFile): CodeFileReadResult {
  return {
    repo: file.repo,
    path: file.path,
    branch: file.branch,
    blobSha: file.blobSha,
    commitSha: file.commitSha,
    content: file.content,
    size: file.size,
  };
}

// Builds the pending approval a reviewer would see, bound to this exact
// proposal's digests. approveWorkspaceStep()/rejectWorkspaceStep()
// (approvalInteraction.ts) only require a matching step/target/tool-id
// shape -- they do not themselves execute anything. riskLevel must match
// CODE_WRITE_TOOL_ID's actual registered risk (tools/githubTools.ts:
// "high") -- writeRuntime.ts's approval-risk check requires the approval's
// risk to be >= the tool's, and a mismatch here would make an otherwise
// valid approval permanently unusable.
function buildPendingApproval(
  step: WorkspacePlanStep,
  proposal: CodeFileProposal,
  preview: CodeApprovalPreview,
  currentTime: Date,
): WorkspaceStepApproval {
  const approval: WorkspaceStepApproval = {
    stepId: step.id,
    targetId: `${proposal.repo}:${proposal.path}`,
    toolId: CODE_WRITE_TOOL_ID,
    toolName: "Update a GitHub file",
    toolDescription: preview.executionScope,
    toolCapability: "update",
    toolMode: "write",
    status: "pending",
    requiresApproval: true,
    approvalReason: "Proposes a change to an existing repository file.",
    riskLevel: "high",
    reversible: false,
    externalEffect: true,
    dataDomains: ["github"],
    approvalScope: "single_step",
    previewText: preview.previewText,
    codeProposalBinding: buildCodeProposalBinding(proposal, currentTime),
  };
  return Object.freeze(approval);
}

export async function requestCodeFileProposal(
  input: RequestCodeFileProposalInput,
  dependencies: Partial<ExecutionEngineDependencies> = {},
): Promise<RequestCodeFileProposalResult> {
  const step = readStep(input.step, input.repo, input.path);
  const currentTime = input.currentTime ?? new Date();
  const requestedAt = currentTime.toISOString();

  const readExecutionResult = await executeAgentTool(
    {
      requestId: input.requestId,
      step,
      toolId: "github.files.read",
      approval: null,
      input: { repo: input.repo, path: input.path },
      requestedAt,
      context: {
        ...input.executionContext,
        currentTime: input.executionContext?.currentTime ?? requestedAt,
      },
    },
    dependencies,
  );

  if (!readExecutionResult.success) {
    return { status: "read_failed", readExecutionResult, errors: [readExecutionResult.error?.message ?? "The file could not be read."] };
  }

  const data = readExecutionResult.data as { connectionStatus?: string; file?: unknown } | undefined;
  if (!data || data.connectionStatus !== "connected" || !data.file) {
    return { status: "not_connected", readExecutionResult, errors: ["GitHub is not connected."] };
  }

  const baseRead = toCodeFileReadResult(data.file as GitHubFileContentFile);
  const buildResult = await buildCodeFileProposal({
    baseRead,
    proposedContent: input.proposedContent,
    requestId: input.requestId,
    stepId: step.id,
  });

  // Explicit equality, not truthiness: this TypeScript toolchain does not
  // narrow a boolean-literal (true/false) discriminant on plain truthiness
  // (`!buildResult.ok`) the way it narrows a string-literal discriminant --
  // `=== false` narrows correctly and is what the rest of this file relies on.
  if (buildResult.ok === false) {
    return { status: "validation_failed", readExecutionResult, errors: buildResult.errors };
  }

  const preview = buildApprovalPreview(buildResult.proposal);
  const approval = buildPendingApproval(step, buildResult.proposal, preview, currentTime);

  return {
    status: "proposed",
    readExecutionResult,
    proposal: buildResult.proposal,
    preview,
    approval,
    errors: [],
  };
}
