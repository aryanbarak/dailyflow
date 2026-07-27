import { describe, expect, it } from "vitest";
import {
  getToolById,
  getToolRiskSummary,
  isToolAllowedForApproval,
  listEnabledTools,
  listTools,
  listToolsByDomain,
  validateToolDefinition,
} from "./toolRegistry";
import type { AgentToolDefinition } from "./toolTypes";
import type {
  WorkspaceApprovalModel,
  WorkspaceApprovalRiskLevel,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

const now = "2026-07-10T09:00:00.000Z";

function stepApproval(
  riskLevel: WorkspaceApprovalRiskLevel,
  status: WorkspaceStepApproval["status"] = "approved",
): WorkspaceStepApproval {
  return {
    stepId: `step:${riskLevel}`,
    status,
    requiresApproval: true,
    approvalReason: "Approved by user in a future approval flow.",
    riskLevel,
    reversible: riskLevel !== "high",
    externalEffect: riskLevel !== "none",
    dataDomains: ["tasks"],
    approvalScope: "single_step",
  };
}

function approval(
  riskLevel: WorkspaceApprovalRiskLevel,
  status: WorkspaceApprovalModel["overallStatus"] = "approved",
): WorkspaceApprovalModel {
  return {
    planId: "plan:tasks:2026-07-10",
    goalId: "goal:tasks:2026-07-10",
    overallStatus: status,
    stepApprovals: [stepApproval(riskLevel)],
    approvalScope: "single_step",
    requiresUserApproval: true,
    approvalSummary: "Approved by user in a future approval flow.",
    riskLevel,
    generatedAt: now,
    reasons: ["Test approval fixture."],
  };
}

function validDefinition(overrides: Partial<AgentToolDefinition> = {}): AgentToolDefinition {
  return {
    id: "system.test_tool",
    name: "Test tool",
    description: "A valid test tool.",
    domain: "system",
    capability: "inspect",
    mode: "read",
    riskLevel: "none",
    requiresApproval: false,
    approvalScope: "view_only",
    reversible: true,
    externalEffect: false,
    inputSchema: [],
    outputSchema: {
      type: "object",
      description: "Test output.",
    },
    enabled: true,
    version: "1.0.0",
    tags: ["test"],
    examples: [
      {
        title: "Test",
        input: {},
        expectedOutcome: "Returns test metadata.",
      },
    ],
    constraints: ["Contract only."],
    ...overrides,
  };
}

describe("toolRegistry", () => {
  it("lists the initial representative catalog", () => {
    const tools = listTools();

    expect(tools.map((tool) => tool.id)).toEqual([
      "tasks.list",
      "calendar.list_today",
      "documents.list_recent",
      "learning.get_progress",
      "workspace.get_context",
      "github.repositories.list",
      "github.issues.list",
      "github.epics.list",
      "github.pulls.list",
      "github.workflow_runs.list",
      "tasks.create",
      "tasks.update",
      "tasks.complete",
      "calendar.create_event",
      "calendar.update_event",
      "habits.mark_complete",
      "messages.send",
      "finance.create_transaction",
      "documents.delete",
    ]);
  });

  it("returns tools by id and safely returns undefined for unknown ids", () => {
    expect(getToolById("tasks.list")?.name).toBe("List tasks");
    expect(getToolById("missing.tool")).toBeUndefined();
  });

  it("filters tools by domain", () => {
    expect(listToolsByDomain("tasks").map((tool) => tool.id)).toEqual([
      "tasks.list",
      "tasks.create",
      "tasks.update",
      "tasks.complete",
    ]);
    expect(listToolsByDomain("finance").map((tool) => tool.id)).toEqual([
      "finance.create_transaction",
    ]);
  });

  it("filters enabled tools", () => {
    expect(listEnabledTools()).toHaveLength(listTools().length);
  });

  it("returns safe copies and keeps the registry immutable", () => {
    const first = getToolById("tasks.list");
    expect(first).toBeDefined();

    if (!first) return;
    first.name = "Mutated";
    first.inputSchema.push({
      name: "mutated",
      type: "string",
      required: false,
      description: "Should not affect registry.",
    });

    const second = getToolById("tasks.list");
    expect(second?.name).toBe("List tasks");
    expect(second?.inputSchema).toEqual([]);
  });

  it("rejects duplicate ids through validation", () => {
    const original = getToolById("tasks.list");
    expect(original).toBeDefined();

    const result = validateToolDefinition(validDefinition({ id: "tasks.list" }), [
      original as AgentToolDefinition,
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("duplicate tool id"))).toBe(true);
  });

  it("rejects missing risk and approval fields", () => {
    const invalid = {
      ...validDefinition(),
      riskLevel: undefined,
      requiresApproval: undefined,
    };

    const result = validateToolDefinition(invalid);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("riskLevel is required.");
    expect(result.errors).toContain("requiresApproval is required.");
  });

  it("classifies read-only tools as no-approval and no-effect", () => {
    const tool = getToolById("workspace.get_context");
    expect(tool).toBeDefined();

    const summary = getToolRiskSummary(tool as AgentToolDefinition);

    expect(summary.riskLevel).toBe("none");
    expect(summary.requiresApproval).toBe(false);
    expect(summary.externalEffect).toBe(false);
    expect(summary.executionEligible).toBe(true);
    expect(isToolAllowedForApproval(tool as AgentToolDefinition)).toBe(true);
  });

  it("requires approval for write tools", () => {
    const createTask = getToolById("tasks.create");
    expect(createTask).toBeDefined();

    const summary = getToolRiskSummary(createTask as AgentToolDefinition);

    expect(summary.riskLevel).toBe("medium");
    expect(summary.requiresApproval).toBe(true);
    expect(summary.externalEffect).toBe(true);
    expect(summary.executionEligible).toBe(false);
    expect(isToolAllowedForApproval(createTask as AgentToolDefinition)).toBe(false);
    expect(isToolAllowedForApproval(createTask as AgentToolDefinition, approval("medium"))).toBe(true);
  });

  it("denies high-risk tools when approval is missing or insufficient", () => {
    const sendMessage = getToolById("messages.send");
    expect(sendMessage).toBeDefined();

    expect(isToolAllowedForApproval(sendMessage as AgentToolDefinition)).toBe(false);
    expect(isToolAllowedForApproval(sendMessage as AgentToolDefinition, approval("medium"))).toBe(false);
    expect(isToolAllowedForApproval(sendMessage as AgentToolDefinition, approval("high", "pending"))).toBe(false);
    expect(isToolAllowedForApproval(sendMessage as AgentToolDefinition, approval("high"))).toBe(true);
  });

  it("lets higher registry risk override lower plan-step risk", () => {
    const financeTool = getToolById("finance.create_transaction");
    expect(financeTool).toBeDefined();

    const insufficientApproval = approval("medium");
    insufficientApproval.stepApprovals = [stepApproval("medium")];

    expect(isToolAllowedForApproval(financeTool as AgentToolDefinition, insufficientApproval)).toBe(false);

    const sufficientApproval = approval("high");
    sufficientApproval.stepApprovals = [stepApproval("medium")];

    expect(isToolAllowedForApproval(financeTool as AgentToolDefinition, sufficientApproval)).toBe(true);
  });

  it("never considers disabled tools allowed", () => {
    const readTool = getToolById("tasks.list");
    expect(readTool).toBeDefined();

    const disabledTool: AgentToolDefinition = {
      ...(readTool as AgentToolDefinition),
      enabled: false,
    };

    expect(getToolRiskSummary(disabledTool).executionEligible).toBe(false);
    expect(isToolAllowedForApproval(disabledTool)).toBe(false);
  });

  it("does not mutate inputs and returns deterministic results", () => {
    const tool = getToolById("tasks.create");
    const sourceApproval = approval("medium");
    expect(tool).toBeDefined();

    const beforeTool = JSON.stringify(tool);
    const beforeApproval = JSON.stringify(sourceApproval);
    const first = isToolAllowedForApproval(tool as AgentToolDefinition, sourceApproval);
    const second = isToolAllowedForApproval(tool as AgentToolDefinition, sourceApproval);

    expect(first).toBe(second);
    expect(JSON.stringify(tool)).toBe(beforeTool);
    expect(JSON.stringify(sourceApproval)).toBe(beforeApproval);
  });
});
