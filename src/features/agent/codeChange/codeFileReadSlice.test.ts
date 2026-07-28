import { describe, expect, it, vi } from "vitest";

// runWriteTool (exercised below) pulls in writeHandlers.ts -> tasksCompleteHandler.ts
// -> the real "@/features/tasks/tasksService", whose module has the side effect of
// constructing the real Supabase client (autoRefreshToken: true) against a
// localStorage that doesn't exist in this test environment. writeRuntime.test.ts
// mocks the same module for the same reason; mirrored here so this file doesn't
// depend on load order relative to other test files.
vi.mock("@/features/tasks/tasksService", () => ({
  TaskServiceError: class extends Error {},
  tasksService: {
    getTaskForUser: vi.fn(),
    completeTask: vi.fn(),
  },
}));

import { approveWorkspaceStep } from "../approvalInteraction";
import { clearExecutionAuditRecords, getExecutionAuditRecordsByRequestId } from "../executionAudit";
import { getToolById } from "../toolRegistry";
import { runWriteTool } from "../writeRuntime";
import { validateCodeProposalApproval } from "./codeProposalApproval";
import { PROSPECTIVE_CODE_WRITE_TOOL_ID, requestCodeFileProposal } from "./codeFileReadSlice";
import type { GitHubFileContentClient, GitHubFileContentFile } from "../executionTypes";
import type { WorkspacePlanStep } from "../../workspace/workspaceTypes";

function step(): WorkspacePlanStep {
  return {
    id: "step:code-file-read",
    order: 1,
    title: "Read README.md before proposing a change",
    description: "Read the current file so a proposal can be built against it.",
    domain: "github",
    estimatedMinutes: 2,
    status: "proposed",
    actionType: "inspect",
    reason: "The user asked to update this file.",
    requiresApproval: false,
    dependencies: [],
    optional: false,
  };
}

function connectedClient(overrides: Partial<GitHubFileContentFile> = {}): GitHubFileContentClient {
  return {
    async readFile() {
      return {
        connectionStatus: "connected" as const,
        file: {
          repo: "aryan/smartflow",
          path: "README.md",
          branch: "main",
          blobSha: "blob-sha-1",
          commitSha: "commit-sha-1",
          content: "hello\n",
          size: 6,
          ...overrides,
        },
      };
    },
  };
}

describe("github.files.read registered contract", () => {
  it("registers one enabled, bounded, read-only, no-approval contract", () => {
    const tool = getToolById("github.files.read");
    expect(tool).toMatchObject({
      domain: "github",
      capability: "read",
      mode: "read",
      riskLevel: "none",
      requiresApproval: false,
      approvalScope: "view_only",
      externalEffect: false,
      reversible: true,
      enabled: true,
    });
    expect(tool?.inputSchema.map((field) => field.name).sort()).toEqual(["path", "repo"]);
  });

  it("does not register any write counterpart -- no mutation tool exists yet", () => {
    expect(getToolById(PROSPECTIVE_CODE_WRITE_TOOL_ID)).toBeUndefined();
  });
});

describe("requestCodeFileProposal", () => {
  it("reads, proposes, diffs, and builds an approval preview end to end", async () => {
    clearExecutionAuditRecords();
    const result = await requestCodeFileProposal({
      requestId: "request:code-1",
      step: step(),
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
      executionContext: { githubFileContentClient: connectedClient() },
      currentTime: new Date("2026-07-28T10:00:00Z"),
    });

    expect(result.status).toBe("proposed");
    expect(result.errors).toEqual([]);
    expect(result.proposal).toMatchObject({
      repo: "aryan/smartflow",
      path: "README.md",
      baseBranch: "main",
      baseCommitSha: "commit-sha-1",
      baseBlobSha: "blob-sha-1",
      operationCount: 1,
    });
    expect(result.preview?.executionScope).toMatch(/cannot create a branch/i);
    expect(result.approval).toMatchObject({
      stepId: "step:code-file-read",
      toolId: PROSPECTIVE_CODE_WRITE_TOOL_ID,
      status: "pending",
      requiresApproval: true,
    });
    expect(result.approval?.codeProposalBinding).toEqual({
      repo: "aryan/smartflow",
      path: "README.md",
      baseBlobSha: "blob-sha-1",
      baseCommitSha: "commit-sha-1",
      proposedContentDigest: result.proposal?.proposedContentDigest,
      proposalId: result.proposal?.proposalId,
      // EPIC-08 Slice 2 -- 15 minutes after the requestCodeFileProposal call's currentTime (2026-07-28T10:00:00Z).
      expiresAt: "2026-07-28T10:15:00.000Z",
    });

    // Execution Audit is reused, not reimplemented: the read went through
    // executeAgentTool, which records "started" then a terminal status.
    const audit = getExecutionAuditRecordsByRequestId("request:code-1");
    expect(audit.map((record) => record.status)).toEqual(["started", "success"]);
    expect(audit.every((record) => record.toolId === "github.files.read")).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/token|authorization/i);
  });

  it("returns not_connected instead of fabricating a proposal when no client is available", async () => {
    const result = await requestCodeFileProposal({
      requestId: "request:code-2",
      step: step(),
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
      executionContext: {},
    });
    expect(result.status).toBe("not_connected");
    expect(result.proposal).toBeUndefined();
    expect(result.approval).toBeUndefined();
  });

  it("fails closed with validation_failed for a protected path, without silently rewriting it", async () => {
    const result = await requestCodeFileProposal({
      requestId: "request:code-3",
      step: step(),
      repo: "aryan/smartflow",
      path: ".env",
      proposedContent: "SECRET=1\n",
      executionContext: {
        githubFileContentClient: connectedClient({ path: ".env" }),
      },
    });
    expect(result.status).toBe("validation_failed");
    expect(result.proposal).toBeUndefined();
    expect(result.errors.some((error) => error.includes("protected"))).toBe(true);
  });

  it("fails closed with validation_failed for oversized proposed content", async () => {
    const result = await requestCodeFileProposal({
      requestId: "request:code-4",
      step: step(),
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "x".repeat(200_000),
      executionContext: { githubFileContentClient: connectedClient() },
    });
    expect(result.status).toBe("validation_failed");
  });

  it("reports read_failed when the file-content client itself throws", async () => {
    const throwingClient: GitHubFileContentClient = {
      async readFile() {
        throw { code: "GITHUB_UNAVAILABLE", message: "GitHub is currently unavailable.", retryable: true };
      },
    };
    const result = await requestCodeFileProposal({
      requestId: "request:code-5b",
      step: step(),
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
      executionContext: { githubFileContentClient: throwingClient },
    });
    expect(result.status).toBe("read_failed");
    expect(result.readExecutionResult.success).toBe(false);
  });
});

describe("no mutation path exists yet (Slice 1 boundary)", () => {
  it("approving the built proposal preview is a structural decision only -- it does not execute anything", async () => {
    const result = await requestCodeFileProposal({
      requestId: "request:code-6",
      step: step(),
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
      executionContext: { githubFileContentClient: connectedClient() },
    });
    if (!result.approval) throw new Error("expected a built approval");

    const decision = approveWorkspaceStep({
      step: step(),
      stepApproval: result.approval,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok === false) return;
    expect(decision.approval?.status).toBe("approved");
    // approveWorkspaceStep only records a decision -- it has no GitHub
    // client, no Worker call, and no side effect of any kind.
  });

  it("attempting to run the prospective write tool through the real write boundary fails closed as unsupported", async () => {
    const writeResult = await runWriteTool({
      requestId: "request:code-7",
      step: { ...step(), actionType: "update", targetId: "aryan/smartflow:README.md" },
      toolResolution: {
        status: "resolved",
        resolved: true,
        stepId: "step:code-file-read",
        toolId: PROSPECTIVE_CODE_WRITE_TOOL_ID,
        confidence: "high",
        reasons: [],
        candidates: [],
        requiredInput: [],
        generatedAt: new Date().toISOString(),
        resolverVersion: "tool-resolver-v1",
      },
      approval: {
        stepId: "step:code-file-read",
        targetId: "aryan/smartflow:README.md",
        toolId: PROSPECTIVE_CODE_WRITE_TOOL_ID,
        status: "approved",
        requiresApproval: true,
        approvalReason: "test",
        riskLevel: "medium",
        reversible: false,
        externalEffect: true,
        dataDomains: ["github"],
        approvalScope: "single_step",
      },
    });
    expect(writeResult.status).toBe("unsupported_tool");
    expect(writeResult.success).toBe(false);
  });

  // EPIC-08 Slice 2 -- a fully valid, unexpired, digest-matching approval
  // binding (the exact contract Slice 2 adds) still must not produce any
  // mutation or any audit/write-log activity, because github.files.update
  // has no registered handler. Validity of the binding and executability
  // through the write boundary are two independent gates.
  it("a fully valid Slice 2 approval binding still ends in unsupported_tool with zero audit activity", async () => {
    clearExecutionAuditRecords();
    const proposed = await requestCodeFileProposal({
      requestId: "request:code-8",
      step: step(),
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
      executionContext: { githubFileContentClient: connectedClient() },
      currentTime: new Date("2026-07-28T10:00:00Z"),
    });
    if (!proposed.approval || !proposed.proposal) throw new Error("expected a built proposal and approval");

    const approved = approveWorkspaceStep({ step: step(), stepApproval: proposed.approval });
    if (approved.ok === false || !approved.approval?.codeProposalBinding) {
      throw new Error("expected the approval to succeed and carry a binding");
    }

    const bindingCheck = validateCodeProposalApproval({
      binding: approved.approval.codeProposalBinding,
      proposal: proposed.proposal,
      currentTime: new Date("2026-07-28T10:05:00Z"),
    });
    expect(bindingCheck).toEqual({ valid: true, reasons: [] });

    const writeRequestId = "request:code-8:write";
    const writeResult = await runWriteTool({
      requestId: writeRequestId,
      step: { ...step(), actionType: "update", targetId: "aryan/smartflow:README.md" },
      toolResolution: {
        status: "resolved",
        resolved: true,
        stepId: "step:code-file-read",
        toolId: PROSPECTIVE_CODE_WRITE_TOOL_ID,
        confidence: "high",
        reasons: [],
        candidates: [],
        requiredInput: [],
        generatedAt: new Date().toISOString(),
        resolverVersion: "tool-resolver-v1",
      },
      approval: { ...approved.approval, targetId: "aryan/smartflow:README.md" },
    });

    expect(writeResult.status).toBe("unsupported_tool");
    expect(writeResult.success).toBe(false);
    expect(getExecutionAuditRecordsByRequestId(writeRequestId)).toEqual([]);
  });
});
