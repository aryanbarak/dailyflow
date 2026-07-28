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
import { CODE_WRITE_TOOL_ID, requestCodeFileProposal } from "./codeFileReadSlice";
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

  // EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
  // Registered as of Slice 3, at a strictly higher risk than any read tool --
  // see writeRuntime.test.ts / githubFilesUpdateHandler.test.ts for its full
  // write-boundary and handler coverage; this file only asserts it exists
  // and carries the risk level this module's own pending approval must match.
  it("registers a real, high-risk write counterpart as of Slice 3", () => {
    const tool = getToolById(CODE_WRITE_TOOL_ID);
    expect(tool).toMatchObject({
      domain: "github",
      capability: "update",
      mode: "write",
      riskLevel: "high",
      requiresApproval: true,
      enabled: true,
    });
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
      toolId: CODE_WRITE_TOOL_ID,
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

  // EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
  // github.files.update is registered riskLevel "high" (tools/githubTools.ts).
  // An approval carrying only "medium" -- e.g. one built before this module's
  // riskLevel fix, or tampered with -- must still fail closed at the approval
  // boundary, never execute.
  it("fails closed at the approval-risk boundary for a medium-risk approval", async () => {
    const writeResult = await runWriteTool({
      requestId: "request:code-7",
      step: { ...step(), actionType: "update", targetId: "aryan/smartflow:README.md" },
      toolResolution: {
        status: "resolved",
        resolved: true,
        stepId: "step:code-file-read",
        toolId: CODE_WRITE_TOOL_ID,
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
        toolId: CODE_WRITE_TOOL_ID,
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
    expect(writeResult.status).toBe("approval_required");
    expect(writeResult.success).toBe(false);
  });

  // EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
  // A fully valid, unexpired, digest-matching, correctly-high-risk approval
  // binding is still not enough to mutate anything through this in-process
  // call alone: there is no githubFileUpdateClient in the execution context,
  // and -- the actual point of Slice 3 -- no server-verifiable approval
  // record exists at the Worker (this test never calls
  // POST /github/code-proposals/approve). Validity of the binding and
  // actual executability are independent gates.
  it("a fully valid Slice 2/3 approval binding alone still cannot execute a mutation", async () => {
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
        toolId: CODE_WRITE_TOOL_ID,
        confidence: "high",
        reasons: [],
        candidates: [],
        requiredInput: [],
        generatedAt: new Date().toISOString(),
        resolverVersion: "tool-resolver-v1",
      },
      approval: { ...approved.approval, targetId: "aryan/smartflow:README.md" },
    });

    // Fails at the authenticated-user boundary (no injected dependencies,
    // no runtime-authenticated identity in this test environment) --
    // whichever boundary it fails at, the point is it never reaches a
    // successful mutation, and it emits no audit activity doing so.
    expect(writeResult.status).toBe("failed");
    expect(writeResult.success).toBe(false);
    expect(getExecutionAuditRecordsByRequestId(writeRequestId)).toEqual([]);
  });
});
