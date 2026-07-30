import { beforeEach, describe, expect, it } from "vitest";
import {
  approveWorkspaceStep,
  closeWorkspaceStepApproval,
  findApprovalPresentationTool,
  rejectWorkspaceStep,
} from "./approvalInteraction";
import {
  clearExecutionIntentLifecycleRegistry,
  createCanonicalExecutionIntent,
  getStoredCanonicalExecutionIntent,
  resolveExecutionIntentApproval,
} from "./executionIntent";
import { getToolById } from "./toolRegistry";
import type { AgentToolDefinition } from "./toolTypes";
import type {
  WorkspaceApprovalRiskLevel,
  WorkspaceApprovalScope,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

const now = new Date("2026-07-10T09:00:00.000Z");

async function expectedCompleteIntentId(sourceStep: WorkspacePlanStep, actorId: string, scopeId: string) {
  const intent = await createCanonicalExecutionIntent({
    candidate: {
      proposedToolId: "tasks.complete",
      proposedOperation: sourceStep.actionType,
      proposedArguments: { taskId: sourceStep.targetId?.trim() },
      sourceProposalReference: sourceStep.id,
    },
    tool: tool("tasks.complete"),
    step: sourceStep,
    actorId,
    scopeId,
    operation: sourceStep.actionType,
    arguments: { taskId: sourceStep.targetId?.trim() },
    sourceProposalReference: sourceStep.id,
    createdAt: now.toISOString(),
  });
  return intent.intentId;
}

function tool(id: string): AgentToolDefinition {
  const found = getToolById(id);
  if (!found) throw new Error(`Missing test tool: ${id}`);
  return found;
}

function step(overrides: Partial<WorkspacePlanStep> = {}): WorkspacePlanStep {
  return {
    id: "step-1",
    order: 1,
    title: "Create task",
    description: "Create a new task.",
    domain: "tasks",
    estimatedMinutes: 10,
    status: "proposed",
    actionType: "create",
    reason: "Tasks need attention.",
    requiresApproval: true,
    dependencies: [],
    optional: false,
    ...overrides,
  };
}

function stepApproval(
  overrides: Partial<WorkspaceStepApproval> = {},
): WorkspaceStepApproval {
  return {
    stepId: "step-1",
    status: "pending",
    requiresApproval: true,
    approvalReason: "Future execution could modify user data.",
    riskLevel: "medium",
    reversible: true,
    externalEffect: true,
    dataDomains: ["tasks"],
    approvalScope: "single_step",
    ...overrides,
  };
}

describe("approvalInteraction", () => {
  beforeEach(() => {
    clearExecutionIntentLifecycleRegistry();
  });

  it("approves an exact step with a typed immutable approval", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step(),
      stepApproval: stepApproval(),
      tool: tool("tasks.create"),
    });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("approved");
    expect(result.approval).toEqual({
      stepId: "step-1",
      toolId: "tasks.create",
      toolName: "Create task",
      toolDescription: "Future contract for creating a task after explicit approval.",
      toolCapability: "create",
      toolMode: "write",
      status: "approved",
      requiresApproval: true,
      approvalReason: "Future execution could modify user data.",
      riskLevel: "medium",
      reversible: true,
      externalEffect: true,
      dataDomains: ["tasks"],
      approvalScope: "single_step",
    });
    expect(Object.isFrozen(result.approval)).toBe(true);
  });

  it("rejects an exact step as rejected, not as approved metadata", () => {
    const result = rejectWorkspaceStep({
      now,
      step: step(),
      stepApproval: stepApproval(),
      tool: tool("tasks.create"),
    });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("rejected");
    expect(result.approval?.status).toBe("rejected");
  });

  it("closes without synthesizing approval", () => {
    const result = closeWorkspaceStepApproval({ now });

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("closed");
    expect(result.approval).toBeNull();
  });

  it("fails safely for a missing step id", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step({ id: "" }),
      stepApproval: stepApproval(),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("MISSING_STEP");
  });

  it("does not accept mismatched step approval", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step({ id: "step-a" }),
      stepApproval: stepApproval({ stepId: "step-b" }),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("STEP_MISMATCH");
  });

  it("does not accept mismatched target approval", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step({ actionType: "complete", targetId: "task-a" }),
      stepApproval: stepApproval({ targetId: "task-b" }),
      tool: tool("tasks.complete"),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("TARGET_MISMATCH");
  });

  it("does not accept mismatched resolved tool approval", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step(),
      stepApproval: stepApproval({ toolId: "tasks.create" }),
      tool: tool("tasks.update"),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("TOOL_MISMATCH");
  });

  it("rejects unsupported approval scope at runtime", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step(),
      stepApproval: stepApproval(),
      requestedApprovalScope: "unsupported" as WorkspaceApprovalScope,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_SCOPE");
  });

  it("rejects scope escalation", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step(),
      stepApproval: stepApproval({ approvalScope: "single_step" }),
      requestedApprovalScope: "entire_plan",
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("SCOPE_ESCALATION");
  });

  it("rejects risk understatement when tool risk is higher", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step({ domain: "finance", actionType: "pay" }),
      stepApproval: stepApproval({
        riskLevel: "medium",
        dataDomains: ["finance"],
      }),
      tool: tool("finance.create_transaction"),
      requestedRiskLevel: "medium",
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("RISK_UNDERSTATEMENT");
  });

  it("preserves effective higher risk when approving", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step({ domain: "finance", actionType: "pay" }),
      stepApproval: stepApproval({
        riskLevel: "medium",
        dataDomains: ["finance"],
      }),
      tool: tool("finance.create_transaction"),
      requestedRiskLevel: "high",
    });

    expect(result.ok).toBe(true);
    expect(result.approval?.riskLevel).toBe("high");
  });

  it("does not copy arbitrary planner payloads or mutate inputs", async () => {
    const sourceStep = step({
      description: "A sensitive planner payload should not be copied.",
    });
    const sourceApproval = stepApproval();
    const before = JSON.stringify({ sourceStep, sourceApproval });

    const first = await approveWorkspaceStep({
      now,
      step: sourceStep,
      stepApproval: sourceApproval,
      tool: tool("tasks.create"),
      requestedRiskLevel: "medium" as WorkspaceApprovalRiskLevel,
    });
    const second = await approveWorkspaceStep({
      now,
      step: sourceStep,
      stepApproval: sourceApproval,
      tool: tool("tasks.create"),
      requestedRiskLevel: "medium",
    });

    expect(second).toEqual(first);
    expect(JSON.stringify({ sourceStep, sourceApproval })).toBe(before);
    expect(JSON.stringify(first)).not.toContain("sensitive planner payload");
    expect(first.approval).not.toHaveProperty("metadata");
  });

  it("finds a matching presentation tool without invoking handlers", () => {
    expect(findApprovalPresentationTool(step({ actionType: "review" }))?.id).toBe("tasks.list");
    expect(findApprovalPresentationTool(step())?.id).toBeUndefined();
    expect(findApprovalPresentationTool(step({ domain: "finance", actionType: "pay" }))).toBeNull();
  });

  // EPIC-08 Slice 1/2 -- see docs/roadmap/epic-08-write-code-design-v1.md.
  it("carries a code proposal's binding (proposal id, base blob/commit SHA, digest, expiry) through approve and reject unchanged", async () => {
    const binding = {
      repo: "aryan/smartflow",
      path: "README.md",
      baseBlobSha: "blob-sha-1",
      baseCommitSha: "commit-sha-1",
      proposedContentDigest: "a".repeat(64),
      proposalId: `code-proposal:${"b".repeat(64)}`,
      expiresAt: "2026-07-10T09:15:00.000Z",
    };
    const approval = stepApproval({
      dataDomains: ["github"],
      previewText: "--- a/README.md\n+++ b/README.md\n",
      codeProposalBinding: binding,
    });

    const approved = await approveWorkspaceStep({ now, step: step(), stepApproval: approval });
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.approval?.codeProposalBinding).toEqual(binding);
      expect(approved.approval?.previewText).toBe(approval.previewText);
    }

    const rejected = rejectWorkspaceStep({ now, step: step(), stepApproval: approval });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(rejected.approval?.codeProposalBinding).toEqual(binding);
    }
  });

  it("omits codeProposalBinding entirely for approvals that never had one (e.g. tasks.complete)", async () => {
    const result = await approveWorkspaceStep({ now, step: step(), stepApproval: stepApproval() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.approval).not.toHaveProperty("codeProposalBinding");
    }
  });

  it("issues tasks.complete approval from trusted actor and authoritative scope", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step({ actionType: "complete", targetId: "task-1" }),
      stepApproval: stepApproval({ targetId: "task-1", toolId: "tasks.complete" }),
      tool: tool("tasks.complete"),
      authorityContext: {
        getAuthenticatedActor: async () => ({ id: "trusted-user" }),
        resolveAuthoritativeScope: async () => "user:trusted-user",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected approval");
    expect(result.approval?.executionIntentApprovalId).toMatch(/^approval:/);
    const binding = resolveExecutionIntentApproval(result.approval?.executionIntentApprovalId);
    const intent = getStoredCanonicalExecutionIntent(binding?.intentId);
    expect(binding?.actorId).toBe("trusted-user");
    expect(intent?.scopeId).toBe("user:trusted-user");
  });

  it("rejects tasks.complete approval without a trusted authenticated actor", async () => {
    const sourceStep = step({ actionType: "complete", targetId: "task-1" });
    const result = await approveWorkspaceStep({
      now,
      step: sourceStep,
      stepApproval: stepApproval({ targetId: "task-1", toolId: "tasks.complete" }),
      tool: tool("tasks.complete"),
      authorityContext: {
        getAuthenticatedActor: async () => null,
        resolveAuthoritativeScope: async () => "user:attacker",
      },
    });

    expect(result.ok).toBe(false);
    if ("approval" in result) expect(result.approval).toBeNull();
    expect(getStoredCanonicalExecutionIntent(await expectedCompleteIntentId(sourceStep, "attacker", "user:attacker"))).toBeUndefined();
    expect(resolveExecutionIntentApproval("approval:missing")).toBeUndefined();
  });

  it("ignores browser actor spoofing and uses the trusted actor", async () => {
    const originalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => "attacker",
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    const result = await approveWorkspaceStep({
      now,
      step: step({ actionType: "complete", targetId: "task-1" }),
      stepApproval: stepApproval({ targetId: "task-1", toolId: "tasks.complete" }),
      tool: tool("tasks.complete"),
      authorityContext: {
        getAuthenticatedActor: async () => ({ id: "trusted-user" }),
        resolveAuthoritativeScope: async ({ actor }) => `user:${actor.id}`,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected approval");
    const binding = resolveExecutionIntentApproval(result.approval?.executionIntentApprovalId);
    expect(binding?.actorId).toBe("trusted-user");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalStorage,
    });
  });

  it("uses trusted scope resolution instead of client-requested scope", async () => {
    const result = await approveWorkspaceStep({
      now,
      step: step({ actionType: "complete", targetId: "task-1" }),
      stepApproval: stepApproval({ targetId: "task-1", toolId: "tasks.complete" }),
      tool: tool("tasks.complete"),
      authorityContext: {
        getAuthenticatedActor: async () => ({ id: "trusted-user" }),
        resolveAuthoritativeScope: async () => "user:trusted-user:scope-a",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected approval");
    const binding = resolveExecutionIntentApproval(result.approval?.executionIntentApprovalId);
    const intent = getStoredCanonicalExecutionIntent(binding?.intentId);
    expect(intent?.scopeId).toBe("user:trusted-user:scope-a");
  });

  it("rejects approval when authoritative scope cannot be resolved", async () => {
    const sourceStep = step({ actionType: "complete", targetId: "task-1" });
    const result = await approveWorkspaceStep({
      now,
      step: sourceStep,
      stepApproval: stepApproval({ targetId: "task-1", toolId: "tasks.complete" }),
      tool: tool("tasks.complete"),
      authorityContext: {
        getAuthenticatedActor: async () => ({ id: "trusted-user" }),
        resolveAuthoritativeScope: async () => null,
      },
    });

    expect(result.ok).toBe(false);
    expect(getStoredCanonicalExecutionIntent(await expectedCompleteIntentId(sourceStep, "trusted-user", "user:trusted-user"))).toBeUndefined();
    expect(resolveExecutionIntentApproval("approval:missing")).toBeUndefined();
  });
});
