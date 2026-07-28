import { describe, expect, it } from "vitest";
import {
  approveWorkspaceStep,
  closeWorkspaceStepApproval,
  findApprovalPresentationTool,
  rejectWorkspaceStep,
} from "./approvalInteraction";
import { getToolById } from "./toolRegistry";
import type { AgentToolDefinition } from "./toolTypes";
import type {
  WorkspaceApprovalRiskLevel,
  WorkspaceApprovalScope,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

const now = new Date("2026-07-10T09:00:00.000Z");

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
  it("approves an exact step with a typed immutable approval", () => {
    const result = approveWorkspaceStep({
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

  it("fails safely for a missing step id", () => {
    const result = approveWorkspaceStep({
      now,
      step: step({ id: "" }),
      stepApproval: stepApproval(),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("MISSING_STEP");
  });

  it("does not accept mismatched step approval", () => {
    const result = approveWorkspaceStep({
      now,
      step: step({ id: "step-a" }),
      stepApproval: stepApproval({ stepId: "step-b" }),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("STEP_MISMATCH");
  });

  it("does not accept mismatched target approval", () => {
    const result = approveWorkspaceStep({
      now,
      step: step({ actionType: "complete", targetId: "task-a" }),
      stepApproval: stepApproval({ targetId: "task-b" }),
      tool: tool("tasks.complete"),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("TARGET_MISMATCH");
  });

  it("does not accept mismatched resolved tool approval", () => {
    const result = approveWorkspaceStep({
      now,
      step: step(),
      stepApproval: stepApproval({ toolId: "tasks.create" }),
      tool: tool("tasks.update"),
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("TOOL_MISMATCH");
  });

  it("rejects unsupported approval scope at runtime", () => {
    const result = approveWorkspaceStep({
      now,
      step: step(),
      stepApproval: stepApproval(),
      requestedApprovalScope: "unsupported" as WorkspaceApprovalScope,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_SCOPE");
  });

  it("rejects scope escalation", () => {
    const result = approveWorkspaceStep({
      now,
      step: step(),
      stepApproval: stepApproval({ approvalScope: "single_step" }),
      requestedApprovalScope: "entire_plan",
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("SCOPE_ESCALATION");
  });

  it("rejects risk understatement when tool risk is higher", () => {
    const result = approveWorkspaceStep({
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

  it("preserves effective higher risk when approving", () => {
    const result = approveWorkspaceStep({
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

  it("does not copy arbitrary planner payloads or mutate inputs", () => {
    const sourceStep = step({
      description: "A sensitive planner payload should not be copied.",
    });
    const sourceApproval = stepApproval();
    const before = JSON.stringify({ sourceStep, sourceApproval });

    const first = approveWorkspaceStep({
      now,
      step: sourceStep,
      stepApproval: sourceApproval,
      tool: tool("tasks.create"),
      requestedRiskLevel: "medium" as WorkspaceApprovalRiskLevel,
    });
    const second = approveWorkspaceStep({
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
  it("carries a code proposal's binding (proposal id, base blob/commit SHA, digest, expiry) through approve and reject unchanged", () => {
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

    const approved = approveWorkspaceStep({ now, step: step(), stepApproval: approval });
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

  it("omits codeProposalBinding entirely for approvals that never had one (e.g. tasks.complete)", () => {
    const result = approveWorkspaceStep({ now, step: step(), stepApproval: stepApproval() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.approval).not.toHaveProperty("codeProposalBinding");
    }
  });
});
