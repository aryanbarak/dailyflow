import { describe, expect, it, vi, beforeEach } from "vitest";

const { taskServiceMock, MockTaskServiceError } = vi.hoisted(() => {
  class HoistedTaskServiceError extends Error {
    readonly code: string;
    readonly retryable: boolean;

    constructor(code: string, message: string, retryable = false) {
      super(message);
      this.name = "TaskServiceError";
      this.code = code;
      this.retryable = retryable;
    }
  }

  return {
    taskServiceMock: {
      getTaskForUser: vi.fn(),
      completeTask: vi.fn(),
    },
    MockTaskServiceError: HoistedTaskServiceError,
  };
});

vi.mock("@/features/tasks/tasksService", () => ({
  TaskServiceError: MockTaskServiceError,
  tasksService: taskServiceMock,
}));

import {
  clearExecutionAuditRecords,
  getExecutionAuditRecordsByRequestId,
} from "./executionAudit";
import { getToolById } from "./toolRegistry";
import { getWriteHandlerByToolId } from "./writeHandlers";
import {
  clearWriteRuntimeRequestHistory,
  runWriteTool,
  type WriteRuntimeRequest,
} from "./writeRuntime";
import { runReadOnlyTool } from "./readOnlyRuntime";
import type {
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionInputValidationResult,
} from "./executionTypes";
import type { ToolResolutionResult } from "./toolResolverTypes";
import type {
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

const now = new Date("2026-07-10T09:00:00.000Z");

function step(overrides: Partial<WorkspacePlanStep> = {}): WorkspacePlanStep {
  return {
    id: "step:complete-task",
    order: 1,
    title: "Complete task",
    description: "Mark the selected task complete.",
    domain: "tasks",
    estimatedMinutes: 1,
    status: "proposed",
    actionType: "complete",
    targetId: "task-1",
    reason: "The task is ready to be marked complete.",
    requiresApproval: true,
    dependencies: [],
    optional: false,
    ...overrides,
  };
}

function resolution(
  sourceStep = step(),
  toolId = "tasks.complete",
  overrides: Partial<ToolResolutionResult> = {},
): ToolResolutionResult {
  return {
    status: "resolved",
    resolved: true,
    stepId: sourceStep.id,
    toolId,
    tool: getToolById(toolId),
    confidence: "high",
    reasons: ["Resolved by test."],
    candidates: [],
    requiredInput: ["taskId"],
    generatedAt: now.toISOString(),
    resolverVersion: "tool-resolver-v1",
    ...overrides,
  };
}

function approval(
  sourceStep = step(),
  overrides: Partial<WorkspaceStepApproval> = {},
): WorkspaceStepApproval {
  return {
    stepId: sourceStep.id,
    targetId: sourceStep.targetId,
    toolId: "tasks.complete",
    status: "approved",
    requiresApproval: true,
    approvalReason: "Completing a task changes user data.",
    riskLevel: "medium",
    reversible: true,
    externalEffect: true,
    dataDomains: ["tasks"],
    approvalScope: "single_step",
    ...overrides,
  };
}

function writeHandler(overrides: Partial<AgentWriteToolHandler> = {}): AgentWriteToolHandler {
  return {
    toolId: "tasks.complete",
    mode: "write",
    readOnly: false,
    externalEffect: true,
    reversible: true,
    requiresVerification: true,
    timeoutMs: 1000,
    validateInput(input: unknown): ExecutionInputValidationResult {
      const record = input as Record<string, unknown>;
      return {
        valid: record.userId === "user-1" && record.taskId === "task-1",
        errors: [],
      };
    },
    execute: vi.fn(async () => ({
      status: "success",
      success: true,
      data: {
        taskId: "task-1",
        completed: true,
        completedAt: now.toISOString(),
        alreadyCompleted: false,
        verified: true,
      },
      auditMetadata: {
        taskId: "task-1",
        alreadyCompleted: false,
        verified: true,
        resultShape: "object",
        redacted: true,
      },
    })),
    ...overrides,
  };
}

function request(overrides: Partial<WriteRuntimeRequest> = {}): WriteRuntimeRequest {
  const sourceStep = overrides.step ?? step();
  return {
    requestId: `write:${Math.random().toString(36).slice(2)}`,
    step: sourceStep,
    toolResolution: resolution(sourceStep),
    approval: approval(sourceStep),
    executionContext: {},
    currentTime: now,
    ...overrides,
  };
}

describe("writeRuntime", () => {
  beforeEach(() => {
    clearExecutionAuditRecords();
    clearWriteRuntimeRequestHistory();
  });

  it("executes one approved tasks.complete request through the write boundary", async () => {
    const handler = writeHandler();
    const result = await runWriteTool(request({ requestId: "write:success" }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.alreadyCompleted).toBe(false);
    expect(result.runtimeVersion).toBe("write-runtime-v1");
    expect(result.safeSummary).toBe("Task was marked complete.");
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(handler.execute).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "task-1",
    }, expect.any(Object));
    const records = getExecutionAuditRecordsByRequestId("write:success");
    expect(records.map((record) => record.status)).toEqual([
      "started",
      "success",
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      requestId: "write:success",
      stepId: "step:complete-task",
      toolId: "tasks.complete",
    });
    expect(records[1]).toMatchObject({
      requestId: "write:success",
      stepId: "step:complete-task",
      toolId: "tasks.complete",
      status: "success",
    });
    const serializedAudit = JSON.stringify(records);
    expect(serializedAudit).not.toContain("user-1");
    expect(serializedAudit).not.toContain("Sensitive");
    expect(serializedAudit).not.toContain("stack");
  });

  it("rejects missing, rejected, wrong-step, wrong-target, and wrong-tool approvals before handler execution", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const cases: Array<[string, WriteRuntimeRequest["approval"], string]> = [
      ["missing", null, "approval_required"],
      ["rejected", approval(sourceStep, { status: "rejected" }), "rejected"],
      ["wrong-step", approval(sourceStep, { stepId: "other-step" }), "approval_required"],
      ["wrong-target", approval(sourceStep, { targetId: "other-task" }), "approval_required"],
      ["wrong-tool", approval(sourceStep, { toolId: "tasks.create" }), "approval_required"],
    ];

    for (const [label, sourceApproval, expectedStatus] of cases) {
      const result = await runWriteTool(request({
        requestId: `write:approval:${label}`,
        step: sourceStep,
        toolResolution: resolution(sourceStep),
        approval: sourceApproval,
      }), {
        getAuthenticatedUserId: () => "user-1",
        getWriteHandlerByToolId: () => handler,
        now: () => now,
      });

      expect(result.status).toBe(expectedStatus);
    }

    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("rejects missing or mismatched task targets", async () => {
    const handler = writeHandler();
    const missingTarget = step({ targetId: undefined });
    const wrongDomain = step({ domain: "calendar" });

    const first = await runWriteTool(request({
      requestId: "write:missing-target",
      step: missingTarget,
      toolResolution: resolution(missingTarget),
      approval: approval(missingTarget),
    }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const second = await runWriteTool(request({
      requestId: "write:wrong-domain",
      step: wrongDomain,
      toolResolution: resolution(wrongDomain),
      approval: approval(wrongDomain),
    }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(first.status).toBe("invalid_input");
    expect(second.status).toBe("invalid_input");
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it.each([
    "tasks.create",
    "tasks.update",
    "calendar.create_event",
    "calendar.update_event",
    "documents.delete",
    "finance.create_transaction",
    "messages.send",
  ])("rejects unsupported write tool %s", async (toolId) => {
    const sourceStep = step({ actionType: toolId.startsWith("tasks.") ? "create" : "update" });
    const result = await runWriteTool(request({
      requestId: `write:unsupported:${toolId}`,
      step: sourceStep,
      toolResolution: resolution(sourceStep, toolId),
      approval: approval(sourceStep, { toolId }),
    }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => writeHandler(),
      now: () => now,
    });

    expect(result.status).toBe("unsupported_tool");
  });

  it("evaluates policy before resolving the write handler", async () => {
    const getWriteHandler = vi.fn(() => writeHandler());
    const result = await runWriteTool(request({
      requestId: "write:policy-denied",
      approval: approval(step(), { riskLevel: "medium" }),
      executionContext: {
        policyContext: {
          stepRiskLevel: "high",
        },
      } as ExecutionContext,
    }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: getWriteHandler,
      now: () => now,
    });

    expect(result.status).toBe("approval_required");
    expect(getWriteHandler).not.toHaveBeenCalled();
  });

  it("rejects duplicate request ids without invoking the handler twice", async () => {
    const handler = writeHandler();
    const sourceRequest = request({ requestId: "write:duplicate" });

    const first = await runWriteTool(sourceRequest, {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const second = await runWriteTool(sourceRequest, {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(first.status).toBe("success");
    expect(second.status).toBe("duplicate_request");
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects concurrent duplicate request ids before a second write handler invocation", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = writeHandler({
      execute: vi.fn(async () => {
        await pending;
        return {
          status: "success",
          success: true,
          data: {
            taskId: "task-1",
            completed: true,
            completedAt: now.toISOString(),
            alreadyCompleted: false,
            verified: true,
          },
          auditMetadata: {
            taskId: "task-1",
            alreadyCompleted: false,
            verified: true,
            resultShape: "object",
            redacted: true,
          },
        };
      }),
    });
    const sourceRequest = request({ requestId: "write:duplicate-in-flight" });

    const first = runWriteTool(sourceRequest, {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const second = await runWriteTool(sourceRequest, {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    release();

    expect((await first).status).toBe("success");
    expect(second.status).toBe("duplicate_request");
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the authenticated user boundary inside runtime dependencies", async () => {
    const handler = writeHandler();
    await runWriteTool(request({
      requestId: "write:auth-boundary",
      executionContext: { userId: "attacker" } as never,
    }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(handler.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", taskId: "task-1" }),
      expect.any(Object),
    );
    expect(handler.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: "attacker" }),
      expect.any(Object),
    );
  });

  it("normalizes verification failure without claiming success", async () => {
    const handler = writeHandler({
      execute: vi.fn(async () => ({
        status: "verification_failed",
        success: false,
        error: {
          code: "VERIFICATION_FAILED",
          message: "Task completion could not be verified.",
          retryable: false,
        },
        auditMetadata: {
          taskId: "task-1",
          alreadyCompleted: false,
          verified: false,
          resultShape: "object",
          redacted: true,
        },
      })),
    });

    const result = await runWriteTool(request({ requestId: "write:verification" }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("verification_failed");
    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(getExecutionAuditRecordsByRequestId("write:verification").map((record) => record.status)).toEqual([
      "started",
      "verification_failed",
    ]);
  });

  it("times out a slow write handler without retrying or leaking raw errors", async () => {
    vi.useFakeTimers();
    const handler = writeHandler({
      timeoutMs: 50,
      execute: vi.fn(() => new Promise(() => undefined)),
    });
    const resultPromise = runWriteTool(request({ requestId: "write:timeout" }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    await vi.advanceTimersByTimeAsync(51);
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result.status).toBe("timeout");
    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(result.safeSummary).toBe("Write action timed out.");
    expect(JSON.stringify(getExecutionAuditRecordsByRequestId("write:timeout"))).not.toContain("user-1");
  });

  it("isolates audit and reflection failures", async () => {
    const handler = writeHandler();
    const result = await runWriteTool(request({ requestId: "write:isolated-failures" }), {
      getAuthenticatedUserId: () => "user-1",
      getWriteHandlerByToolId: () => handler,
      appendExecutionAuditRecord: () => {
        throw new Error("Audit unavailable.");
      },
      processReflection: () => {
        throw new Error("Reflection unavailable.");
      },
      now: () => now,
    });

    expect(result.status).toBe("success");
    expect(result.auditCorrelation.startedAuditId).toBeUndefined();
    expect(result.auditCorrelation.terminalAuditId).toBeUndefined();
    expect(result.reflection).toBeUndefined();
  });

  // Regression coverage for a bug where SUPPORTED_WRITE_TOOL_IDS listed
  // github.issues.comment/update, but validateResolvedTool's capability
  // check, taskTargetIsValid's actionType/domain check, and the handlerInput
  // builder were all still hardcoded to tasks.complete's shape -- so every
  // approved github write proposal died with "unsupported_tool" before ever
  // reaching the handler, and even past that would never have carried
  // repo/issueNumber/commentBody to it. Uses the REAL registered tool
  // (getToolById) and the REAL githubIssuesCommentHandler (getWriteHandlerByToolId)
  // -- only the GitHub client is mocked -- and asserts the mock was called
  // with the exact extracted arguments, not just that the run didn't error.
  it("runs an approved github.issues.comment proposal end-to-end and calls the client with the exact target fields", async () => {
    const sourceStep = step({
      id: "step:github-comment",
      title: "Add a GitHub issue comment",
      description: "Comment on aryan/smartflow#5.",
      domain: "github",
      actionType: "create",
      targetId: "aryan/smartflow#5",
    });
    const sourceResolution = resolution(sourceStep, "github.issues.comment", {
      requiredInput: ["repo", "issueNumber", "body"],
    });
    const sourceApproval = approval(sourceStep, {
      toolId: "github.issues.comment",
      dataDomains: ["github"],
      reversible: false,
      previewText: "Thanks, looking into this.",
    });
    const createComment = vi.fn().mockResolvedValue({
      commentId: 42,
      url: "https://github.com/aryan/smartflow/issues/5#issuecomment-42",
    });

    const result = await runWriteTool(request({
      requestId: "write:github-comment",
      step: sourceStep,
      toolResolution: sourceResolution,
      approval: sourceApproval,
      target: { repo: "aryan/smartflow", issueNumber: 5, commentBody: "Thanks, looking into this." },
      executionContext: {
        githubIssueCommentClient: { createComment },
      } as ExecutionContext,
    }), {
      getAuthenticatedUserId: () => "user-1",
      now: () => now,
    });

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment).toHaveBeenCalledWith({
      repo: "aryan/smartflow",
      issueNumber: 5,
      body: "Thanks, looking into this.",
    });
    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.toolId).toBe("github.issues.comment");
    expect(result.safeSummary).toBe("Comment added.");
  });

  it("runs an approved github.issues.update proposal end-to-end and calls the client with the exact target fields", async () => {
    const sourceStep = step({
      id: "step:github-update",
      title: "Update a GitHub issue",
      description: "Update aryan/smartflow#5.",
      domain: "github",
      actionType: "update",
      targetId: "aryan/smartflow#5",
    });
    const sourceResolution = resolution(sourceStep, "github.issues.update", {
      requiredInput: ["repo", "issueNumber"],
    });
    const sourceApproval = approval(sourceStep, {
      toolId: "github.issues.update",
      dataDomains: ["github"],
      reversible: false,
      previewText: "Labels: bug, priority:high",
    });
    const updateIssue = vi.fn().mockResolvedValue({
      issueNumber: 5,
      url: "https://github.com/aryan/smartflow/issues/5",
    });

    const result = await runWriteTool(request({
      requestId: "write:github-update",
      step: sourceStep,
      toolResolution: sourceResolution,
      approval: sourceApproval,
      target: { repo: "aryan/smartflow", issueNumber: 5, updateLabels: ["bug", "priority:high"] },
      executionContext: {
        githubIssueUpdateClient: { updateIssue },
      } as ExecutionContext,
    }), {
      getAuthenticatedUserId: () => "user-1",
      now: () => now,
    });

    expect(updateIssue).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenCalledWith({
      repo: "aryan/smartflow",
      issueNumber: 5,
      labels: ["bug", "priority:high"],
    });
    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.toolId).toBe("github.issues.update");
    expect(result.safeSummary).toBe("Issue updated.");
  });

  it("keeps read-only runtime and write runtime isolated", async () => {
    const sourceStep = step();
    const result = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: approval(sourceStep),
      currentTime: now,
    }, {
      getHandlerByToolId: () => {
        throw new Error("Read-only runtime must not resolve write handlers.");
      },
      now: () => now,
    });

    expect(result.status).toBe("unresolved");
    expect(getWriteHandlerByToolId("tasks.list")).toBeUndefined();
    expect(getWriteHandlerByToolId("tasks.complete")?.toolId).toBe("tasks.complete");
  });
});
