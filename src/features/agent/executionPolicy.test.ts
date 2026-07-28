import { describe, expect, it } from "vitest";
import {
  compareRiskLevels,
  evaluateExecutionPolicy,
  getRequiredApprovalScope,
  isApprovalScopeSufficient,
  isStepToolMappingValid,
  resolveEffectiveRisk,
} from "./executionPolicy";
import { getToolById } from "./toolRegistry";
import type { AgentToolDefinition } from "./toolTypes";
import type {
  WorkspaceApprovalRiskLevel,
  WorkspaceApprovalScope,
  WorkspacePlanActionType,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

const now = new Date("2026-07-10T09:00:00.000Z");

function tool(id: string): AgentToolDefinition {
  const found = getToolById(id);
  if (!found) throw new Error(`Missing test tool: ${id}`);
  return found;
}

function step(
  actionType: WorkspacePlanActionType,
  overrides: Partial<WorkspacePlanStep> = {},
): WorkspacePlanStep {
  return {
    id: "step-1",
    order: 1,
    title: `${actionType} step`,
    description: `${actionType} description.`,
    domain: "tasks",
    estimatedMinutes: 10,
    status: "proposed",
    actionType,
    targetId: actionType === "update" || actionType === "delete" ? "target-1" : undefined,
    reason: `${actionType} reason.`,
    requiresApproval: actionType !== "review" && actionType !== "inspect",
    dependencies: [],
    optional: false,
    ...overrides,
  };
}

function approval(
  stepId = "step-1",
  riskLevel: WorkspaceApprovalRiskLevel = "medium",
  approvalScope: WorkspaceApprovalScope = "single_step",
  status: WorkspaceStepApproval["status"] = "approved",
  toolId = status === "not_required" ? undefined : "tasks.create",
): WorkspaceStepApproval {
  return {
    stepId,
    toolId,
    status,
    requiresApproval: status !== "not_required",
    approvalReason: "Approved by user in a future approval flow.",
    riskLevel,
    reversible: riskLevel !== "high",
    externalEffect: riskLevel !== "none",
    dataDomains: ["tasks"],
    approvalScope,
  };
}

describe("executionPolicy", () => {
  it("denies missing tool safely", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("review"),
      tool: null,
    });

    expect(decision.status).toBe("tool_not_found");
    expect(decision.allowed).toBe(false);
  });

  it("denies unknown tool lookup safely", () => {
    const missingTool = getToolById("unknown.tool");
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("review"),
      tool: missingTool,
    });

    expect(decision.status).toBe("tool_not_found");
    expect(decision.allowed).toBe(false);
  });

  it("denies disabled tools", () => {
    const disabledTool: AgentToolDefinition = {
      ...tool("tasks.list"),
      enabled: false,
    };

    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("review"),
      tool: disabledTool,
    });

    expect(decision.status).toBe("tool_disabled");
    expect(decision.allowed).toBe(false);
  });

  it("allows valid read-only no-effect tools", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("review"),
      tool: tool("tasks.list"),
      approval: approval("step-1", "none", "view_only", "not_required"),
    });

    expect(decision.status).toBe("allowed");
    expect(decision.allowed).toBe(true);
    expect(decision.effectiveRiskLevel).toBe("none");
    expect(decision.requiredApprovalScope).toBe("view_only");
  });

  it("denies read-only invalid mapping", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("review", { domain: "finance" }),
      tool: tool("tasks.list"),
      approval: approval("step-1", "none", "view_only", "not_required"),
    });

    expect(decision.status).toBe("domain_mismatch");
    expect(decision.allowed).toBe(false);
  });

  it("denies write tools without approval", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("create"),
      tool: tool("tasks.create"),
    });

    expect(decision.status).toBe("approval_required");
    expect(decision.allowed).toBe(false);
  });

  it("denies pending approval", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("create"),
      tool: tool("tasks.create"),
      approval: approval("step-1", "medium", "single_step", "pending"),
    });

    expect(decision.status).toBe("approval_required");
    expect(decision.allowed).toBe(false);
  });

  it("denies rejected approval", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("create"),
      tool: tool("tasks.create"),
      approval: approval("step-1", "medium", "single_step", "rejected"),
    });

    expect(decision.status).toBe("approval_required");
    expect(decision.allowed).toBe(false);
  });

  it("allows approved exact-step write tool", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("create"),
      tool: tool("tasks.create"),
      approval: approval("step-1", "medium"),
    });

    expect(decision.status).toBe("allowed");
    expect(decision.allowed).toBe(true);
    expect(decision.matchedToolId).toBe("tasks.create");
  });

  it("allows tasks.complete only with exact approved step and tool at medium external-effect risk", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("complete", { targetId: "task-1" }),
      tool: tool("tasks.complete"),
      approval: approval("step-1", "medium", "single_step", "approved", "tasks.complete"),
    });

    expect(decision.status).toBe("allowed");
    expect(decision.allowed).toBe(true);
    expect(decision.matchedToolId).toBe("tasks.complete");
    expect(decision.effectiveRiskLevel).toBe("medium");
    expect(decision.requiredApprovalScope).toBe("single_step");
    expect(tool("tasks.complete")).toMatchObject({
      mode: "write",
      externalEffect: true,
      riskLevel: "medium",
      requiresApproval: true,
    });
  });

  it.each([
    ["pending approval", approval("step-1", "medium", "single_step", "pending", "tasks.complete"), "approval_required"],
    ["rejected approval", approval("step-1", "medium", "single_step", "rejected", "tasks.complete"), "approval_required"],
    ["wrong step", approval("step-2", "medium", "single_step", "approved", "tasks.complete"), "approval_required"],
    ["wrong tool", approval("step-1", "medium", "single_step", "approved", "tasks.create"), "approval_required"],
    ["insufficient scope", approval("step-1", "medium", "view_only", "approved", "tasks.complete"), "scope_insufficient"],
  ] as const)("denies tasks.complete with %s", (_name, sourceApproval, expectedStatus) => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("complete", { targetId: "task-1" }),
      tool: tool("tasks.complete"),
      approval: sourceApproval,
    });

    expect(decision.status).toBe(expectedStatus);
    expect(decision.allowed).toBe(false);
  });

  // EPIC-08 Slice 2 -- see docs/roadmap/epic-08-write-code-design-v1.md.
  // A synthetic, unregistered high-risk tool shaped like a future code
  // mutation tool -- this deliberately does not register github.files.update
  // anywhere; it only proves the policy layer's approval-risk comparison is
  // >=, so a higher-risk tool correctly requires a matching-or-higher
  // approval risk rather than silently inheriting a lower one.
  it("requires approval risk >= a hypothetical high-risk code-mutation tool's risk level", () => {
    const highRiskCodeTool: AgentToolDefinition = {
      ...tool("github.issues.update"),
      id: "github.files.update",
      riskLevel: "high",
      reversible: false,
    };
    const sourceStep = step("update", { domain: "github", targetId: "aryan/smartflow:README.md" });

    const deniedWithMediumApproval = evaluateExecutionPolicy({
      currentTime: now,
      step: sourceStep,
      tool: highRiskCodeTool,
      approval: approval("step-1", "medium", "single_step", "approved", "github.files.update"),
    });
    expect(deniedWithMediumApproval.status).toBe("risk_mismatch");
    expect(deniedWithMediumApproval.allowed).toBe(false);

    const allowedWithHighApproval = evaluateExecutionPolicy({
      currentTime: now,
      step: sourceStep,
      tool: highRiskCodeTool,
      approval: approval("step-1", "high", "single_step", "approved", "github.files.update"),
    });
    expect(allowedWithHighApproval.status).toBe("allowed");
    expect(allowedWithHighApproval.allowed).toBe(true);
    expect(allowedWithHighApproval.effectiveRiskLevel).toBe("high");
  });

  it("denies approval for another step", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("create"),
      tool: tool("tasks.create"),
      approval: approval("step-2", "medium"),
    });

    expect(decision.status).toBe("approval_required");
    expect(decision.allowed).toBe(false);
  });

  it("denies approval for another tool on the same step", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("update", { targetId: "task-1" }),
      tool: tool("tasks.update"),
      approval: approval("step-1", "medium", "single_step", "approved", "tasks.create"),
    });

    expect(decision.status).toBe("approval_required");
    expect(decision.allowed).toBe(false);
    expect(decision.checks.find((item) => item.id === "approval-tool")?.passed).toBe(false);
  });

  it("denies insufficient scope", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("create"),
      tool: tool("tasks.create"),
      approval: approval("step-1", "medium", "view_only"),
    });

    expect(decision.status).toBe("scope_insufficient");
    expect(decision.allowed).toBe(false);
  });

  it("denies when higher tool risk overrides lower approval risk", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("pay", { domain: "finance" }),
      tool: tool("finance.create_transaction"),
      approval: approval("step-1", "medium", "single_step", "approved", "finance.create_transaction"),
    });

    expect(decision.status).toBe("risk_mismatch");
    expect(decision.effectiveRiskLevel).toBe("high");
    expect(decision.allowed).toBe(false);
  });

  it("requires explicit approval for high-risk external-effect tools", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("pay", { domain: "finance" }),
      tool: tool("finance.create_transaction"),
      approval: approval("step-1", "high", "single_step", "pending", "finance.create_transaction"),
    });

    expect(decision.status).toBe("approval_required");
    expect(decision.allowed).toBe(false);
  });

  it("allows high-risk external-effect tools only with exact approved high-risk approval", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("pay", { domain: "finance" }),
      tool: tool("finance.create_transaction"),
      approval: approval("step-1", "high", "single_step", "approved", "finance.create_transaction"),
    });

    expect(decision.status).toBe("allowed");
    expect(decision.allowed).toBe(true);
  });

  it("fails closed for irreversible tools without sufficient approval", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("delete", { domain: "documents", targetId: "document-1" }),
      tool: tool("documents.delete"),
      approval: approval("step-1", "low", "single_step", "approved", "documents.delete"),
    });

    expect(decision.status).toBe("risk_mismatch");
    expect(decision.allowed).toBe(false);
  });

  it("denies domain mismatch", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("create", { domain: "calendar" }),
      tool: tool("tasks.create"),
      approval: approval("step-1", "medium"),
    });

    expect(decision.status).toBe("domain_mismatch");
    expect(decision.allowed).toBe(false);
  });

  it("denies capability mismatch", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("review"),
      tool: tool("tasks.create"),
      approval: approval("step-1", "medium"),
    });

    expect(decision.status).toBe("capability_mismatch");
    expect(decision.allowed).toBe(false);
  });

  it("denies missing required input", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: null,
      tool: tool("tasks.list"),
    });

    expect(decision.status).toBe("invalid_mapping");
    expect(decision.allowed).toBe(false);
    expect(decision.stepId).toBe("unknown-step");
  });

  it("denies missing target for target-dependent actions", () => {
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("update", { targetId: undefined, targetRoute: undefined }),
      tool: tool("tasks.update"),
      approval: approval("step-1", "medium"),
    });

    expect(decision.status).toBe("invalid_mapping");
    expect(decision.allowed).toBe(false);
  });

  it("does not mutate inputs and is deterministic with injected time", () => {
    const sourceStep = step("create");
    const sourceTool = tool("tasks.create");
    const sourceApproval = approval("step-1", "medium");
    const before = JSON.stringify({ sourceStep, sourceTool, sourceApproval });

    const first = evaluateExecutionPolicy({
      currentTime: now,
      step: sourceStep,
      tool: sourceTool,
      approval: sourceApproval,
    });
    const second = evaluateExecutionPolicy({
      currentTime: now,
      step: sourceStep,
      tool: sourceTool,
      approval: sourceApproval,
    });

    expect(second).toEqual(first);
    expect(JSON.stringify({ sourceStep, sourceTool, sourceApproval })).toBe(before);
  });

  it("exposes pure helper behavior", () => {
    expect(compareRiskLevels("high", "medium")).toBeGreaterThan(0);
    expect(resolveEffectiveRisk("low", "medium", "high")).toBe("high");
    expect(isApprovalScopeSufficient("multiple_steps", "single_step")).toBe(true);
    expect(getRequiredApprovalScope(tool("tasks.create"))).toBe("single_step");
    expect(isStepToolMappingValid(step("create"), tool("tasks.create"))).toBe(true);
  });

  it("has no tool handler invocation path", () => {
    const selectedTool = tool("tasks.create");

    expect("handler" in selectedTool).toBe(false);
    const decision = evaluateExecutionPolicy({
      currentTime: now,
      step: step("create"),
      tool: selectedTool,
      approval: approval("step-1", "medium"),
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toContain("Execution Policy V1 allows this future execution request.");
  });
});
