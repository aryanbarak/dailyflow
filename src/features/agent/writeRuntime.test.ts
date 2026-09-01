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

// Task 22: calendarCreateEventHandler/calendarUpdateEventHandler (reached
// transitively via writeHandlers.ts) import calendarService.ts, which
// imports the real Supabase client -- mocked here for the same reason
// tasksService is mocked above, so this test never touches a real client
// (and never throws the DEV-mode VITE_SMARTFLOW_SUPABASE_MODE guard).
const { calendarServiceMock } = vi.hoisted(() => ({
  calendarServiceMock: {
    create: vi.fn(),
    update: vi.fn(),
    getAll: vi.fn(),
  },
}));

vi.mock("@/features/calendar/calendarService", () => ({
  calendarService: calendarServiceMock,
}));

// Task 28: financeCreateTransactionHandler (reached transitively via
// writeHandlers.ts) imports financeService.ts, which imports the real
// Supabase client -- mocked here for the exact same reason
// tasksService/calendarService are mocked above.
const { financeServiceMock } = vi.hoisted(() => ({
  financeServiceMock: {
    createTransaction: vi.fn(),
    listTransactions: vi.fn(),
  },
}));

vi.mock("@/features/finance/financeService", () => ({
  financeService: financeServiceMock,
}));

import {
  clearExecutionAuditRecords,
  getExecutionAuditRecordsByRequestId,
} from "./executionAudit";
import { getToolById } from "./toolRegistry";
import { getWriteHandlerByToolId } from "./writeHandlers";
import { writeIntentRegistry } from "../../../shared/writeIntentRegistry";
import {
  clearExecutionIntentLifecycleRegistry,
  createCanonicalExecutionIntent,
  getStoredCanonicalExecutionIntent,
  issueExecutionIntentApproval,
  resolveExecutionIntentApproval,
  revokeExecutionIntentApproval,
  storeCanonicalExecutionIntent,
  type CanonicalExecutionIntent,
  type IntentApprovalBinding,
} from "./executionIntent";
import { approveWorkspaceStep } from "./approvalInteraction";
import {
  clearWriteRuntimeRequestHistory,
  expectedCapabilityForToolId,
  expectedStepShapeForToolId,
  requestWriteExecution,
  runWriteTool,
  validateApprovalBoundary,
  type WriteRuntimeRequest,
} from "./writeRuntime";
import { runReadOnlyTool } from "./readOnlyRuntime";
import type {
  AgentWriteToolExecutionResult,
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

async function canonicalIntentFor(sourceStep = step(), actorId = "user-1") {
  return createCanonicalExecutionIntent({
    candidate: {
      proposedToolId: "tasks.complete",
      proposedOperation: "complete",
      proposedArguments: { taskId: sourceStep.targetId },
      sourceProposalReference: sourceStep.id,
    },
    tool: getToolById("tasks.complete"),
    step: sourceStep,
    actorId,
    scopeId: `user:${actorId}`,
    operation: "complete",
    arguments: { taskId: sourceStep.targetId },
    sourceProposalReference: sourceStep.id,
    idempotencyKey: "write:test",
    createdAt: now.toISOString(),
  });
}

async function replaceStoredApproval(
  approvalId: string,
  sourceIntent: CanonicalExecutionIntent,
  overrides: Partial<IntentApprovalBinding>,
) {
  const replacementIntent = {
    ...sourceIntent,
    ...(overrides.intentId ? { intentId: overrides.intentId } : {}),
    ...(overrides.canonicalHash ? { canonicalHash: overrides.canonicalHash } : {}),
    ...(overrides.canonicalizationVersion ? { intentVersion: overrides.canonicalizationVersion } : {}),
    ...(overrides.hashAlgorithm ? { hashAlgorithm: overrides.hashAlgorithm } : {}),
    ...(overrides.scope ? { approvalRequirement: overrides.scope } : {}),
  } as CanonicalExecutionIntent;
  storeCanonicalExecutionIntent(replacementIntent);
  await issueExecutionIntentApproval({
    intent: replacementIntent,
    actorId: overrides.actorId ?? replacementIntent.actorId,
    approvedAt: overrides.approvedAt ?? now.toISOString(),
    approvalId,
    expiresAt: overrides.expiresAt,
  });
  if (overrides.revokedAt) {
    revokeExecutionIntentApproval(approvalId, overrides.revokedAt);
  }
}

async function serverApproval(
  sourceStep = step(),
  overrides: Partial<IntentApprovalBinding> = {},
): Promise<WorkspaceStepApproval> {
  const actorId = overrides.actorId ?? "user-1";
  const intent = await canonicalIntentFor(sourceStep, actorId);
  const issued = await issueExecutionIntentApproval({
    intent,
    actorId,
    approvedAt: overrides.approvedAt ?? now.toISOString(),
    approvalId: overrides.approvalId,
    expiresAt: overrides.expiresAt,
  });
  if (
    overrides.intentId ||
    overrides.canonicalHash ||
    overrides.canonicalizationVersion ||
    overrides.hashAlgorithm ||
    overrides.scope ||
    overrides.actorId ||
    overrides.revokedAt
  ) {
    await replaceStoredApproval(issued.approvalId, intent, overrides);
  }
  return approval(sourceStep, { executionIntentApprovalId: issued.approvalId });
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

function trustedAuthority(actorId = "user-1") {
  return {
    getAuthenticatedActor: async () => ({ id: actorId }),
    resolveAuthoritativeScope: async () => `user:${actorId}`,
  };
}

async function productionApprovedStep(sourceStep = step(), overrides: Parameters<typeof approveWorkspaceStep>[0] = {}) {
  const decision = await approveWorkspaceStep({
    now,
    step: sourceStep,
    stepApproval: approval(sourceStep, { status: "pending" }),
    tool: getToolById("tasks.complete"),
    authorityContext: {
      getAuthenticatedActor: async () => ({ id: "user-1" }),
      resolveAuthoritativeScope: async () => "user:user-1",
    },
    ...overrides,
  });
  if (!decision.ok || !decision.approval) throw new Error("expected production approval to succeed");
  return decision.approval;
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
    clearExecutionIntentLifecycleRegistry();
  });

  it("executes one approved tasks.complete request through the write boundary", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:success",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.alreadyCompleted).toBe(false);
    expect(result.runtimeVersion).toBe("write-runtime-v1");
    expect(result.safeSummary).toBe("Task was marked complete.");
    expect(result.executionIntent).toMatchObject({
      intentId: expect.stringMatching(/^intent:/),
      canonicalHash: expect.any(String),
      approvalId: expect.stringMatching(/^approval:/),
      attemptId: "write:success",
      resultStatus: "succeeded",
    });
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
        authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
        getWriteHandlerByToolId: () => handler,
        now: () => now,
      });

      expect(result.status).toBe(expectedStatus);
    }

    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("issues an opaque intent-bound approval through the production approval function", async () => {
    const sourceStep = step();
    const approved = await productionApprovedStep(sourceStep);

    expect(approved.executionIntentApprovalId).toMatch(/^approval:/);
    const binding = resolveExecutionIntentApproval(approved.executionIntentApprovalId);
    expect(binding).toMatchObject({
      actorId: "user-1",
      scope: "single_step",
      hashAlgorithm: "SHA-256",
    });
    const storedIntent = getStoredCanonicalExecutionIntent(binding?.intentId);
    expect(storedIntent).toMatchObject({
      toolId: "tasks.complete",
      operation: "complete",
      normalizedArguments: { taskId: "task-1" },
      targetScope: { taskId: "task-1" },
    });
  });

  it("approves through the production function and then executes the handler once through Run", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const approved = await productionApprovedStep(sourceStep);

    const result = await runWriteTool(request({
      requestId: "write:production-approve-run",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: approved,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("success");
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(handler.execute).toHaveBeenCalledWith({ userId: "user-1", taskId: "task-1" }, expect.any(Object));
  });

  it("rejects Run without a trusted runtime actor before claim or handler execution", async () => {
    const handler = writeHandler();
    const claim = vi.fn(() => true);
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:runtime-auth-missing",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: {
        getAuthenticatedActor: async () => null,
        resolveAuthoritativeScope: async () => "user:attacker",
      },
      claimExecutionIntent: claim,
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("failed");
    expect(claim).not.toHaveBeenCalled();
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("ignores browser actor spoofing at Run and uses the trusted runtime actor", async () => {
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => "attacker"),
        key: vi.fn(() => "smartflow.auth.userId"),
        length: 1,
      },
    });
    const handler = writeHandler();
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:runtime-auth-localstorage-spoof",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: trustedAuthority("user-1"),
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("success");
    expect(handler.execute).toHaveBeenCalledWith({ userId: "user-1", taskId: "task-1" }, expect.any(Object));
    expect(globalThis.localStorage.getItem).not.toHaveBeenCalled();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalStorage,
    });
  });

  it("rejects Run when the trusted runtime actor differs from the approved actor before claim", async () => {
    const handler = writeHandler();
    const claim = vi.fn(() => true);
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:runtime-auth-actor-mismatch",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: trustedAuthority("user-2"),
      claimExecutionIntent: claim,
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("approval_required");
    expect(claim).not.toHaveBeenCalled();
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("ignores client actor injection and keeps trusted runtime actor authoritative", async () => {
    const handler = writeHandler();
    const sourceStep = step({ actorId: "attacker" } as Partial<WorkspacePlanStep>);
    const result = await runWriteTool(request({
      requestId: "write:runtime-auth-client-injection",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
      executionContext: { userId: "attacker" } as never,
    }), {
      authorityContext: trustedAuthority("user-1"),
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("success");
    expect(handler.execute).toHaveBeenCalledWith({ userId: "user-1", taskId: "task-1" }, expect.any(Object));
    expect(handler.execute).not.toHaveBeenCalledWith(expect.objectContaining({ userId: "attacker" }), expect.any(Object));
  });

  it("fails closed when runtime auth resolution throws before claim or handler execution", async () => {
    const handler = writeHandler();
    const claim = vi.fn(() => true);
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:runtime-auth-throws",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: {
        getAuthenticatedActor: async () => {
          throw new Error("auth unavailable");
        },
        resolveAuthoritativeScope: async () => "user:user-1",
      },
      claimExecutionIntent: claim,
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("failed");
    expect(claim).not.toHaveBeenCalled();
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("rejects Run when authoritative runtime scope cannot be validated before claim", async () => {
    const handler = writeHandler();
    const claim = vi.fn(() => true);
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:runtime-scope-missing",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: {
        getAuthenticatedActor: async () => ({ id: "user-1" }),
        resolveAuthoritativeScope: async () => null,
      },
      claimExecutionIntent: claim,
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("approval_required");
    expect(claim).not.toHaveBeenCalled();
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("denies approval before issuing an opaque reference when policy blocks the intent", async () => {
    const sourceStep = step();
    const decision = await approveWorkspaceStep({
      now,
      step: sourceStep,
      stepApproval: approval(sourceStep, { status: "pending" }),
      tool: getToolById("tasks.complete"),
      authorityContext: {
        getAuthenticatedActor: async () => ({ id: "user-1" }),
        resolveAuthoritativeScope: async () => "user:user-1",
      },
      policyContext: { stepRiskLevel: "high" },
    });

    expect(decision.ok).toBe(false);
    if (!("errorCode" in decision)) throw new Error("expected policy denial");
    expect(decision.errorCode).toBe("POLICY_DENIED");
  });

  it("rejects tasks.complete with legacy approval but no server-owned exact binding", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:intent-binding:missing",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: approval(sourceStep),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("approval_required");
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("rejects fabricated or unknown client approval references", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:intent-binding:fabricated",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: approval(sourceStep, { executionIntentApprovalId: "approval:fabricated" }),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("approval_required");
    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("rejects tasks.complete approval records for another intent, hash, version, actor, scope, expired, or revoked state", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const intent = await canonicalIntentFor(sourceStep);
    const issued = await issueExecutionIntentApproval({
      intent,
      actorId: "user-1",
      approvedAt: now.toISOString(),
    });
    const cases: Array<[string, IntentApprovalBinding]> = [
      ["other-intent", { ...issued, intentId: "intent:other" }],
      ["old-hash", { ...issued, canonicalHash: "0".repeat(64) }],
      ["old-version", { ...issued, canonicalizationVersion: "execution-intent-canonical-old" as never }],
      ["other-actor", { ...issued, actorId: "user-2" }],
      ["other-scope", { ...issued, scope: "entire_plan" }],
      ["expired", { ...issued, expiresAt: "2026-07-10T08:30:00.000Z" }],
      ["revoked", { ...issued, revokedAt: now.toISOString() }],
    ];

    for (const [label, storedApproval] of cases) {
      const result = await runWriteTool(request({
        requestId: `write:intent-binding:${label}`,
        step: sourceStep,
        toolResolution: resolution(sourceStep),
        approval: approval(sourceStep, { executionIntentApprovalId: issued.approvalId }),
      }), {
        authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
        getWriteHandlerByToolId: () => handler,
        getStoredCanonicalExecutionIntent: () => intent,
        resolveExecutionIntentApproval: () => storedApproval,
        now: () => now,
      });

      expect(["policy_denied", "approval_required", "rejected"], label).toContain(result.status);
    }

    expect(handler.execute).not.toHaveBeenCalled();
  });

  it("rejects client target substitution against the server-owned canonical intent", async () => {
    const handler = writeHandler();
    const approvedStep = step({ targetId: "task-1" });
    const requestedStep = step({ targetId: "task-2" });
    const result = await runWriteTool(request({
      requestId: "write:intent-binding:substitution",
      step: requestedStep,
      toolResolution: resolution(requestedStep),
      approval: await serverApproval(approvedStep),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("approval_required");
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
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const second = await runWriteTool(request({
      requestId: "write:wrong-domain",
      step: wrongDomain,
      toolResolution: resolution(wrongDomain),
      approval: approval(wrongDomain),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(first.status).toBe("invalid_input");
    expect(second.status).toBe("invalid_input");
    expect(handler.execute).not.toHaveBeenCalled();
  });

  // Task 30: "finance.create_transaction" used to be listed here -- a stale
  // assertion left over from when it really was unsupported (a future
  // placeholder with no handler). It has been a real, registered write tool
  // since task 28 (financeTools.ts, financeCreateTransactionHandler.ts),
  // and SUPPORTED_WRITE_TOOL_IDS has included it via writeIntentRegistry
  // since then too -- this test was asserting the exact production bug task
  // 30 fixes (expectedCapabilityForToolId/expectedStepShapeForToolId's
  // switches were missing a case for it) as if it were correct behavior.
  // Replaced with finance.delete_transaction, a plausible but genuinely
  // unsupported action (no delete capability exists for the finance
  // domain) so this guard still covers "an unregistered tool id in a
  // registered domain" without re-asserting the bug. See the
  // "supports every write-registry entry" test below for the positive
  // guard that would have caught this regression.
  it.each([
    "documents.delete",
    "finance.delete_transaction",
    "messages.send",
  ])("rejects unsupported write tool %s", async (toolId) => {
    const sourceStep = step({ actionType: toolId.startsWith("tasks.") ? "create" : "update" });
    const result = await runWriteTool(request({
      requestId: `write:unsupported:${toolId}`,
      step: sourceStep,
      toolResolution: resolution(sourceStep, toolId),
      approval: approval(sourceStep, { toolId }),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => writeHandler(),
      now: () => now,
    });

    expect(result.status).toBe("unsupported_tool");
  });

  // Task 30 regression guard: create_finance_transaction was a registered
  // write tool (financeTools.ts, SUPPORTED_WRITE_TOOL_IDS via
  // writeIntentRegistry) whose OWN capability/step-shape switches in this
  // file (expectedCapabilityForToolId, expectedStepShapeForToolId) were
  // missing a case for it -- both fell through to `undefined` (TS strict
  // mode is off here, so this was never caught at typecheck), which made
  // validateResolvedTool reject it as "unsupported_tool" despite being
  // fully registered. This loops over EVERY writeIntentRegistry entry (not
  // just finance) and drives it all the way to "success" through the real
  // runWriteTool path -- including deriving riskLevel from the entry's own
  // registered tool (getToolById(entry.toolId).riskLevel) rather than
  // assuming "medium", which is what let a second bug (ChatPage.tsx's own
  // approvalForReasoningStep hardcoding riskLevel: 'medium') hide behind
  // the first one -- so the next write domain added to the registry cannot
  // ship with either gap unnoticed.
  // Task 45c, ADR-0017: import_bank_statement is excluded from this loop by
  // design, not an oversight -- it is the first registry entry that is
  // deliberately NEVER meant to execute through runWriteTool at all (see
  // its own writeIntentRegistry.ts entry comment: no chat trigger, no
  // registered writeHandlers.ts handler, batch execution happens server-side
  // in agent/worker/flow-write-policy.ts's executeBatchFinanceImport
  // instead). It also has no toolRegistry.ts AgentToolDefinition entry --
  // adding one just to satisfy this generic loop would misrepresent it as a
  // normal, chat-executable write tool, which is exactly what its own
  // multi-layered guard (this file, intentValidator.ts, writeHandlers.ts)
  // exists to prevent. Without a catalog entry, getToolById already returns
  // undefined for it in production, so validateResolvedTool fails it closed
  // as 'unsupported_tool' -- a safe outcome this loop's own stubbed-handler
  // setup does not exercise (it substitutes a fake handler specifically to
  // isolate the capability/step-shape derivation this loop tests, which is
  // exactly the machinery import_bank_statement is NOT meant to reach).
  it.each(
    writeIntentRegistry
      .filter((entry) => entry.intentType !== "import_bank_statement")
      .map((entry) => [entry.toolId, entry] as const),
  )(
    "%s resolves through the write runtime's tool-support lookup and succeeds",
    async (_toolId, entry) => {
      const tool = getToolById(entry.toolId);
      if (!tool) throw new Error(`no registered tool for ${entry.toolId}`);
      const targetId = `step:registry-loop:${entry.toolId}`;
      const sourceStep = step({
        id: targetId,
        domain: entry.domain,
        actionType: entry.action,
        targetId,
      });
      const target = Object.fromEntries(
        (entry.createRequiredTargetFields ?? []).map((field) => [field, "value"]),
      );
      const handler = writeHandler({
        toolId: entry.toolId,
        validateInput: () => ({ valid: true, errors: [] }),
      });
      const result = await runWriteTool(request({
        requestId: `write:registry-loop:${entry.toolId}`,
        step: sourceStep,
        toolResolution: resolution(sourceStep, entry.toolId),
        approval: approval(sourceStep, {
          toolId: entry.toolId,
          targetId,
          riskLevel: tool.riskLevel,
          dataDomains: [entry.domain],
        }),
        target,
      }), {
        authorityContext: trustedAuthority(),
        getWriteHandlerByToolId: () => handler,
        now: () => now,
      });

      expect(result.status).not.toBe("unsupported_tool");
      expect(result.status).toBe("success");
    },
  );

  // Task 45c, ADR-0017: the positive claim the exclusion comment above
  // makes -- that import_bank_statement fails closed through runWriteTool
  // -- tested directly, not just asserted in a comment. Uses the REAL
  // (default) getToolById and getWriteHandlerByToolId, neither stubbed,
  // proving both independent gaps (no toolRegistry.ts catalog entry, no
  // writeHandlers.ts handler) actually produce 'unsupported_tool' in this
  // codebase today, not merely in theory.
  it("finance.import_bank_statement is NOT resolvable through runWriteTool -- no toolRegistry.ts entry, so it fails closed as 'unsupported_tool' before even reaching a handler lookup", async () => {
    const entry = writeIntentRegistry.find((e) => e.intentType === "import_bank_statement")!;
    const targetId = "step:import-bank-statement-guard";
    const sourceStep = step({
      id: targetId,
      domain: entry.domain,
      actionType: entry.action,
      targetId,
    });
    const result = await runWriteTool(request({
      requestId: "write:import-bank-statement-guard",
      step: sourceStep,
      toolResolution: resolution(sourceStep, entry.toolId),
      approval: approval(sourceStep, {
        toolId: entry.toolId,
        targetId,
        riskLevel: "medium",
        dataDomains: [entry.domain],
      }),
      target: { batchId: "batch-1" },
    }), {
      authorityContext: trustedAuthority(),
      now: () => now,
    });

    expect(result.status).toBe("unsupported_tool");
  });

  // Task 36e guard, ADR-0013 Slice 4: expectedCapabilityForToolId and
  // expectedStepShapeForToolId are about to collapse their five
  // per-registry-toolId cases into a single findWriteIntentDescriptorByToolId
  // lookup. This asserts, directly against the two functions (not just
  // end-to-end through runWriteTool, which the "resolves through the write
  // runtime's tool-support lookup" test above already does), that every
  // registry entry's capability/action/domain is exactly what these two
  // functions return for that entry's toolId -- independent of whether the
  // implementation is a switch or a lookup, so this stays a behavior guard
  // across the refactor, not a reflection of either implementation's shape.
  it.each(writeIntentRegistry.map((entry) => [entry.toolId, entry] as const))(
    "%s: expectedCapabilityForToolId/expectedStepShapeForToolId match the registry entry",
    (_toolId, entry) => {
      expect(expectedCapabilityForToolId(entry.toolId)).toBe(entry.capability);
      expect(expectedStepShapeForToolId(entry.toolId)).toEqual({
        actionType: entry.action,
        domain: entry.domain,
      });
    },
  );

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
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: getWriteHandler,
      now: () => now,
    });

    expect(result.status).toBe("approval_required");
    expect(getWriteHandler).not.toHaveBeenCalled();
  });

  it("rejects duplicate request ids without invoking the handler twice", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const sourceRequest = request({
      requestId: "write:duplicate",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    });

    const first = await runWriteTool(sourceRequest, {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const second = await runWriteTool(sourceRequest, {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(first.status).toBe("success");
    expect(second.status).toBe("duplicate_request");
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects a reused approved intent even when the second Run uses a different request id", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const approved = await productionApprovedStep(sourceStep);

    const first = await runWriteTool(request({
      requestId: "write:intent-duplicate:first",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: approved,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const second = await runWriteTool(request({
      requestId: "write:intent-duplicate:second",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: approved,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
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
    const sourceStep = step();
    const sourceRequest = request({
      requestId: "write:duplicate-in-flight",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    });

    const first = runWriteTool(sourceRequest, {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const second = await runWriteTool(sourceRequest, {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    release();

    expect((await first).status).toBe("success");
    expect(second.status).toBe("duplicate_request");
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects concurrent Runs that reuse the same approved intent", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = writeHandler({
      execute: vi.fn(async (): Promise<AgentWriteToolExecutionResult> => {
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
    const sourceStep = step();
    const approved = await productionApprovedStep(sourceStep);

    const first = runWriteTool(request({
      requestId: "write:intent-concurrent:first",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: approved,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const second = runWriteTool(request({
      requestId: "write:intent-concurrent:second",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: approved,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });
    const results = await Promise.all([second, Promise.resolve().then(() => {
      release();
      return first;
    })]);

    expect(results.map((result) => result.status).sort()).toEqual(["duplicate_request", "success"]);
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the authenticated user boundary inside runtime dependencies", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    await runWriteTool(request({
      requestId: "write:auth-boundary",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
      executionContext: { userId: "attacker" } as never,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
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

    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:verification",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
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
    const handler = writeHandler({
      timeoutMs: 1,
      execute: vi.fn((): Promise<AgentWriteToolExecutionResult> => new Promise(() => undefined)),
    });
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:timeout",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      getWriteHandlerByToolId: () => handler,
      now: () => now,
    });

    expect(result.status).toBe("timeout");
    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(handler.execute).toHaveBeenCalledTimes(1);
    expect(result.safeSummary).toBe("Write action timed out.");
    expect(JSON.stringify(getExecutionAuditRecordsByRequestId("write:timeout"))).not.toContain("user-1");
  });

  it("isolates audit and reflection failures", async () => {
    const handler = writeHandler();
    const sourceStep = step();
    const result = await runWriteTool(request({
      requestId: "write:isolated-failures",
      step: sourceStep,
      toolResolution: resolution(sourceStep),
      approval: await serverApproval(sourceStep),
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
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
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
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

  // Task 22 (calendar write slice). Uses the REAL registered tool
  // (getToolById) and the REAL calendarCreateEventHandler
  // (getWriteHandlerByToolId, via the default dependency) -- only
  // calendarService is mocked -- mirroring the github.issues.comment
  // regression test above, closing the same class of gap it was written
  // to catch (capability/shape/handlerInput hardcoded to the wrong tool).
  // BLOCKER A correction: calendarCreateEventHandler/calendarUpdateEventHandler
  // no longer have a direct calendarService fallback -- an
  // agentToolExecutionClient must be supplied in executionContext, exactly
  // as ChatPage.tsx's own production wiring does (see
  // ChatPageAgentExecutionWiring.test.tsx), or the handler fails closed.
  // These two tests now assert against that client instead of
  // calendarService directly; calendarServiceMock stays imported/mocked
  // above for other tests in this file, but these two no longer touch it.
  it("runs an approved calendar.create_event proposal end-to-end and calls the Worker execution client with the exact target fields", async () => {
    const sourceStep = step({
      id: "step:calendar-create",
      title: "Create a calendar event",
      description: "Create event: Team sync.",
      domain: "calendar",
      actionType: "create",
      targetId: "step:calendar-create",
    });
    const sourceResolution = resolution(sourceStep, "calendar.create_event", {
      requiredInput: ["title", "start", "end"],
    });
    // BLOCKER 1 correction: serverExecutionId simulates a PRIOR, pre-approval
    // requestWriteExecution() call already having durably created this row
    // (see writeRuntime.ts's own requestWriteExecution and ChatPage.tsx's
    // wiring) -- runWriteTool now only ever calls approveExecution() with
    // this id, never requestExecution()+approveExecution() together.
    const sourceApproval = approval(sourceStep, {
      toolId: "calendar.create_event",
      dataDomains: ["calendar"],
      reversible: true,
      previewText: "Title: Team sync\nStart: 2026-08-14T09:00:00.000Z",
      serverExecutionId: "exec-cal-create-1",
    });
    const requestExecution = vi.fn();
    const approveExecution = vi.fn().mockResolvedValue({
      status: "succeeded",
      reply: "Event created.",
      targetId: "event-1",
    });

    const result = await runWriteTool(request({
      requestId: "write:calendar-create",
      step: sourceStep,
      toolResolution: sourceResolution,
      approval: sourceApproval,
      target: { eventTitle: "Team sync", start: "2026-08-14T09:00:00.000Z" },
      executionContext: {
        agentToolExecutionClient: { requestExecution, approveExecution },
      } as ExecutionContext,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      now: () => now,
    });

    expect(requestExecution).not.toHaveBeenCalled();
    expect(approveExecution).toHaveBeenCalledTimes(1);
    expect(approveExecution).toHaveBeenCalledWith("exec-cal-create-1");
    expect(calendarServiceMock.create).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.toolId).toBe("calendar.create_event");
    expect(result.safeSummary).toBe("Event created.");
  });

  it("runs an approved calendar.update_event proposal end-to-end and calls the Worker execution client with the exact target fields", async () => {
    const sourceStep = step({
      id: "step:calendar-update",
      title: "Update a calendar event",
      description: "Update event: Team sync.",
      domain: "calendar",
      actionType: "update",
      targetId: "event-1",
    });
    const sourceResolution = resolution(sourceStep, "calendar.update_event", {
      requiredInput: ["eventId"],
    });
    // BLOCKER 1 correction: see the create test above's own comment.
    const sourceApproval = approval(sourceStep, {
      toolId: "calendar.update_event",
      dataDomains: ["calendar"],
      reversible: true,
      previewText: "Start: 2026-08-14T10:00:00.000Z",
      serverExecutionId: "exec-cal-update-1",
    });
    const requestExecution = vi.fn();
    const approveExecution = vi.fn().mockResolvedValue({
      status: "succeeded",
      reply: "Event updated.",
      title: "Team sync",
      dateTimeStart: "2026-08-14T10:00:00.000Z",
    });

    const result = await runWriteTool(request({
      requestId: "write:calendar-update",
      step: sourceStep,
      toolResolution: sourceResolution,
      approval: sourceApproval,
      target: { start: "2026-08-14T10:00:00.000Z" },
      executionContext: {
        agentToolExecutionClient: { requestExecution, approveExecution },
      } as ExecutionContext,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      now: () => now,
    });

    expect(requestExecution).not.toHaveBeenCalled();
    expect(approveExecution).toHaveBeenCalledTimes(1);
    expect(approveExecution).toHaveBeenCalledWith("exec-cal-update-1");
    expect(calendarServiceMock.update).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.toolId).toBe("calendar.update_event");
    expect(result.safeSummary).toBe("Event updated.");
  });

  it("BLOCKER A: an approved calendar.create_event proposal with no agentToolExecutionClient fails closed instead of writing directly to calendarService", async () => {
    const sourceStep = step({
      id: "step:calendar-create-no-client",
      title: "Create a calendar event",
      description: "Create event: Team sync.",
      domain: "calendar",
      actionType: "create",
      targetId: "step:calendar-create-no-client",
    });
    const sourceResolution = resolution(sourceStep, "calendar.create_event", {
      requiredInput: ["title", "start", "end"],
    });
    const sourceApproval = approval(sourceStep, {
      toolId: "calendar.create_event",
      dataDomains: ["calendar"],
      reversible: true,
      previewText: "Title: Team sync\nStart: 2026-08-14T09:00:00.000Z",
    });

    const result = await runWriteTool(request({
      requestId: "write:calendar-create-no-client",
      step: sourceStep,
      toolResolution: sourceResolution,
      approval: sourceApproval,
      target: { eventTitle: "Team sync", start: "2026-08-14T09:00:00.000Z" },
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      now: () => now,
    });

    expect(calendarServiceMock.create).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.success).toBe(false);
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
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
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

  // EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
  it("runs an approved github.files.update proposal end-to-end and calls the client with the exact target fields", async () => {
    const sourceStep = step({
      id: "step:github-files-update",
      title: "Update README.md",
      description: "Commit an approved change to aryan/smartflow:README.md.",
      domain: "github",
      actionType: "update",
      targetId: "aryan/smartflow:README.md",
    });
    const sourceResolution = resolution(sourceStep, "github.files.update", {
      requiredInput: ["proposalId", "repo", "path", "proposedContent"],
    });
    const sourceApproval = approval(sourceStep, {
      toolId: "github.files.update",
      dataDomains: ["github"],
      riskLevel: "high",
      reversible: false,
      previewText: "+hello world",
    });
    const updateFile = vi.fn().mockResolvedValue({
      repo: "aryan/smartflow",
      path: "README.md",
      branch: "smartflow/epic-08/abc123def456",
      commitSha: "commit-sha-new",
      blobSha: "blob-sha-new",
      commitUrl: "https://github.com/aryan/smartflow/commit/commit-sha-new",
    });

    const result = await runWriteTool(request({
      requestId: "write:github-files-update",
      step: sourceStep,
      toolResolution: sourceResolution,
      approval: sourceApproval,
      target: {
        proposalId: "code-proposal:abc",
        repo: "aryan/smartflow",
        path: "README.md",
        proposedContent: "hello world\n",
      },
      executionContext: {
        githubFileUpdateClient: { updateFile },
      } as ExecutionContext,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      now: () => now,
    });

    expect(updateFile).toHaveBeenCalledTimes(1);
    expect(updateFile).toHaveBeenCalledWith({
      proposalId: "code-proposal:abc",
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
    });
    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.toolId).toBe("github.files.update");
    expect(result.safeSummary).toBe("File updated.");
  });

  // Regression coverage: github.files.update is registered riskLevel "high"
  // (Decision 6), not "medium" like the two EPIC-07 write tools -- a
  // medium-risk approval must not be sufficient to run it.
  it("rejects github.files.update with only a medium-risk approval", async () => {
    const sourceStep = step({
      id: "step:github-files-update-risk",
      domain: "github",
      actionType: "update",
      targetId: "aryan/smartflow:README.md",
    });
    const sourceApproval = approval(sourceStep, {
      toolId: "github.files.update",
      dataDomains: ["github"],
      riskLevel: "medium",
      reversible: false,
    });
    const updateFile = vi.fn();

    const result = await runWriteTool(request({
      requestId: "write:github-files-update-risk",
      step: sourceStep,
      toolResolution: resolution(sourceStep, "github.files.update"),
      approval: sourceApproval,
      target: { proposalId: "p", repo: "aryan/smartflow", path: "README.md", proposedContent: "x" },
      executionContext: { githubFileUpdateClient: { updateFile } } as ExecutionContext,
    }), {
      authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
      now: () => now,
    });

    expect(result.status).toBe("approval_required");
    expect(updateFile).not.toHaveBeenCalled();
  });

  // EPIC-08 Slice 2 -- see docs/roadmap/epic-08-write-code-design-v1.md.
  // Regression coverage for a bug where validateApprovalBoundary hardcoded
  // `approval.riskLevel !== "medium"` -- an exact-match check that happened
  // to work only because every currently-supported write tool's registered
  // riskLevel is exactly "medium". A higher-than-required approval risk is
  // strictly *more* authorization, not less, and must still be accepted.
  describe("approval risk comparison is >=, not an exact match", () => {
    it("accepts a higher-than-required approval risk level (medium-risk tool, high-risk approval)", async () => {
      const handler = writeHandler();
      const sourceStep = step();
      const result = await runWriteTool(request({
        requestId: "write:risk-high-approval",
        step: sourceStep,
        toolResolution: resolution(sourceStep),
        approval: await serverApproval(sourceStep),
      }), {
        authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
        getWriteHandlerByToolId: () => handler,
        now: () => now,
      });

      expect(result.status).toBe("success");
      expect(handler.execute).toHaveBeenCalledTimes(1);
    });

    it("still rejects a lower-than-required approval risk level (medium-risk tool, low-risk approval)", async () => {
      const handler = writeHandler();
      const result = await runWriteTool(request({
        requestId: "write:risk-low-approval",
        approval: approval(step(), { riskLevel: "low" }),
      }), {
        authorityContext: { getAuthenticatedActor: async () => ({ id: "user-1" }), resolveAuthoritativeScope: async () => "user:user-1" },
        getWriteHandlerByToolId: () => handler,
        now: () => now,
      });

      expect(result.status).toBe("approval_required");
      expect(handler.execute).not.toHaveBeenCalled();
    });

    // Direct unit coverage of validateApprovalBoundary's own comparison,
    // exercised against a required risk level higher than any
    // currently-registered write tool uses (e.g. a future high-risk code
    // mutation tool) -- without registering a real high-risk tool, which
    // EPIC-08 Slice 2 must not do.
    it("requires approval risk >= a hypothetical high-risk code tool's required risk", () => {
      const sourceStep = step();
      const mediumApproval = approval(sourceStep, { toolId: "github.files.update", riskLevel: "medium" });
      const highApproval = approval(sourceStep, { toolId: "github.files.update", riskLevel: "high" });

      expect(
        validateApprovalBoundary(
          request({ step: sourceStep, approval: mediumApproval }),
          "github.files.update",
          "high",
        ),
      ).toBe("approval_required");

      expect(
        validateApprovalBoundary(
          request({ step: sourceStep, approval: highApproval }),
          "github.files.update",
          "high",
        ),
      ).toBeNull();
    });
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

  // Chat V2 Slice 2A, BLOCKER 1 CORRECTION: requestWriteExecution is the
  // new pre-approval call ChatPage.tsx's own wiring makes as soon as a
  // write proposal is normalized -- well BEFORE the user has approved
  // anything. These tests prove the properties the correction explicitly
  // required: a durable row exists before approval, no domain mutation
  // happens as part of creating it, and the stable WriteRuntimeRequest
  // requestId (never a handler-local random UUID) is what reaches the
  // Worker.
  describe("requestWriteExecution (BLOCKER 1: pre-approval durable request)", () => {
    const authorityContext = {
      getAuthenticatedActor: async () => ({ id: "user-1" }),
      resolveAuthoritativeScope: async () => "user:user-1",
    };

    it("creates a durable approval_pending row BEFORE any user approval exists on the request -- proving no domain mutation occurred, since approveExecution is never called", async () => {
      const sourceStep = step({
        id: "step:pre-approval-create",
        domain: "tasks",
        actionType: "create",
        targetId: "step:pre-approval-create",
      });
      const requestExecution = vi.fn().mockResolvedValue({ status: "approval_pending", executionId: "exec-pre-1" });
      const approveExecution = vi.fn();

      // Deliberately NO `approval` field at all on this request -- proving
      // this call is genuinely independent of, and prior to, any approval
      // decision (unlike runWriteTool, which refuses to proceed without
      // one).
      const result = await requestWriteExecution({
        requestId: "write:pre-approval-1",
        step: sourceStep,
        toolResolution: resolution(sourceStep, "tasks.create", { requiredInput: ["title"] }),
        target: { title: "Call Ahmad" },
        executionContext: { agentToolExecutionClient: { requestExecution, approveExecution } } as ExecutionContext,
      }, { authorityContext });

      expect(result).toEqual({ status: "requested", executionId: "exec-pre-1", serverStatus: "approval_pending", errorCode: undefined });
      expect(requestExecution).toHaveBeenCalledTimes(1);
      expect(approveExecution).not.toHaveBeenCalled();
    });

    // BLOCKER 2: the requestId the Worker actually receives is
    // request.requestId itself -- writeRuntime's OWN stable, application-
    // level attempt id -- never freshly minted inside this call.
    it("propagates the exact WriteRuntimeRequest.requestId to the Worker, never a freshly generated id", async () => {
      const sourceStep = step({ id: "step:stable-id", domain: "tasks", actionType: "create", targetId: "step:stable-id" });
      const requestExecution = vi.fn().mockResolvedValue({ status: "approval_pending", executionId: "exec-stable-1" });

      await requestWriteExecution({
        requestId: "write:the-one-true-id",
        step: sourceStep,
        toolResolution: resolution(sourceStep, "tasks.create", { requiredInput: ["title"] }),
        target: { title: "Call Ahmad" },
        executionContext: { agentToolExecutionClient: { requestExecution, approveExecution: vi.fn() } } as ExecutionContext,
      }, { authorityContext });

      expect(requestExecution).toHaveBeenCalledWith(expect.objectContaining({ requestId: "write:the-one-true-id" }));
    });

    it("is not_applicable for a tool that isn't one of the five Worker-execution-backed tools -- never calls the Worker", async () => {
      const sourceStep = step({ id: "step:github", domain: "github", actionType: "create", targetId: "aryan/smartflow#5" });
      const requestExecution = vi.fn();

      const result = await requestWriteExecution({
        requestId: "write:github-1",
        step: sourceStep,
        toolResolution: resolution(sourceStep, "github.issues.comment", { requiredInput: [] }),
        target: { repo: "aryan/smartflow", issueNumber: 5, commentBody: "hi" },
        executionContext: { agentToolExecutionClient: { requestExecution, approveExecution: vi.fn() } } as ExecutionContext,
      }, { authorityContext });

      expect(result).toEqual({ status: "not_applicable" });
      expect(requestExecution).not.toHaveBeenCalled();
    });

    it("is blocked, not silently skipped, when no agentToolExecutionClient is present in context", async () => {
      const sourceStep = step({ id: "step:no-client", domain: "tasks", actionType: "create", targetId: "step:no-client" });

      const result = await requestWriteExecution({
        requestId: "write:no-client-1",
        step: sourceStep,
        toolResolution: resolution(sourceStep, "tasks.create", { requiredInput: ["title"] }),
        target: { title: "Call Ahmad" },
        executionContext: {},
      }, { authorityContext });

      expect(result).toEqual({ status: "blocked", errorCode: "AGENT_EXECUTION_CLIENT_UNAVAILABLE" });
    });

    it("surfaces the Worker's own rejection (e.g. POLICY_DENIED) as blocked, without throwing", async () => {
      const sourceStep = step({ id: "step:denied", domain: "tasks", actionType: "create", targetId: "step:denied" });
      const requestExecution = vi.fn().mockRejectedValue({ code: "POLICY_DENIED", message: "Denied." });

      const result = await requestWriteExecution({
        requestId: "write:denied-1",
        step: sourceStep,
        toolResolution: resolution(sourceStep, "tasks.create", { requiredInput: ["title"] }),
        target: { title: "Call Ahmad" },
        executionContext: { agentToolExecutionClient: { requestExecution, approveExecution: vi.fn() } } as ExecutionContext,
      }, { authorityContext });

      expect(result).toEqual({ status: "blocked", errorCode: "POLICY_DENIED" });
    });
  });
});
