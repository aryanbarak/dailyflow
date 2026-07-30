import { describe, expect, it } from "vitest";
import {
  clearExecutionAuditRecords,
  getExecutionAuditRecordsByRequestId,
} from "./executionAudit";
import { approveWorkspaceStep } from "./approvalInteraction";
import { getToolById } from "./toolRegistry";
import { resolveToolForStep } from "./toolResolver";
import {
  canStartTasksListRun,
  runTasksListVerticalSlice,
  summarizeTasksListResult,
} from "./tasksListVerticalSlice";
import type { AgentToolHandler } from "./executionTypes";
import type {
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";
import type { ToolResolutionResult } from "./toolResolverTypes";

const now = new Date("2026-07-10T09:00:00.000Z");

function taskReviewStep(overrides: Partial<WorkspacePlanStep> = {}): WorkspacePlanStep {
  return {
    id: "step-tasks-review",
    order: 1,
    title: "Review active work",
    description: "Scan active tasks.",
    domain: "tasks",
    estimatedMinutes: 10,
    status: "proposed",
    actionType: "review",
    reason: "Task load is visible.",
    requiresApproval: false,
    dependencies: [],
    optional: false,
    ...overrides,
  };
}

function approval(overrides: Partial<WorkspaceStepApproval> = {}): WorkspaceStepApproval {
  return {
    stepId: "step-tasks-review",
    toolId: "tasks.list",
    status: "not_required",
    requiresApproval: false,
    approvalReason: "Read-only or reflective step; no approval required.",
    riskLevel: "none",
    reversible: true,
    externalEffect: false,
    dataDomains: ["tasks"],
    approvalScope: "view_only",
    ...overrides,
  };
}

function resolution(step = taskReviewStep()) {
  return resolveToolForStep({ step, currentTime: now });
}

describe("tasksListVerticalSlice", () => {
  it("task review resolves to tasks.list", () => {
    const result = resolution();

    expect(result.status).toBe("resolved");
    expect(result.toolId).toBe("tasks.list");
  });

  it("approval alone does not execute", async () => {
    clearExecutionAuditRecords();
    const step = taskReviewStep({ requiresApproval: true });
    const approved = await approveWorkspaceStep({
      now,
      step,
      stepApproval: approval({
        status: "pending",
        requiresApproval: true,
        approvalScope: "single_step",
      }),
      tool: getToolById("tasks.list"),
    });

    expect(approved.ok).toBe(true);
    expect(getExecutionAuditRecordsByRequestId("anything")).toEqual([]);
  });

  it("explicit Run executes once and writes correlated audit records", async () => {
    clearExecutionAuditRecords();
    const result = await runTasksListVerticalSlice({
      step: taskReviewStep(),
      resolution: resolution(),
      approval: approval(),
      tasks: [{ id: "task-1", title: "Review invoices", completed: false }],
      currentTime: now,
      requestId: "request:tasks-list-success",
    }, {
      now: () => now,
    });

    expect(result.status).toBe("success");
    expect(result.summary).toBe("1 active task found.");
    expect(getExecutionAuditRecordsByRequestId("request:tasks-list-success").map((record) => record.status)).toEqual([
      "started",
      "success",
    ]);
  });

  it("duplicate click guard prevents a second start while running", () => {
    expect(canStartTasksListRun("ready")).toBe(true);
    expect(canStartTasksListRun("running")).toBe(false);
  });

  it("policy denial prevents handler invocation", async () => {
    let handlerResolved = false;
    const result = await runTasksListVerticalSlice({
      step: taskReviewStep(),
      resolution: resolution(),
      approval: approval({ stepId: "another-step" }),
      tasks: [],
      currentTime: now,
      requestId: "request:policy-denied",
    }, {
      now: () => now,
      getHandlerByToolId: () => {
        handlerResolved = true;
        return undefined;
      },
    });

    expect(result.status).toBe("denied");
    expect(handlerResolved).toBe(false);
  });

  it("wrong-step and wrong-tool approval block execution", async () => {
    const wrongStep = await runTasksListVerticalSlice({
      step: taskReviewStep(),
      resolution: resolution(),
      approval: approval({ stepId: "wrong-step" }),
      tasks: [],
      currentTime: now,
    }, { now: () => now });
    const wrongTool = await runTasksListVerticalSlice({
      step: taskReviewStep(),
      resolution: resolution(),
      approval: approval({ toolId: "tasks.update" }),
      tasks: [],
      currentTime: now,
    }, { now: () => now });

    expect(wrongStep.status).toBe("denied");
    expect(wrongTool.status).toBe("denied");
  });

  it("maps zero, one, and many active task summaries", async () => {
    const base = {
      step: taskReviewStep(),
      resolution: resolution(),
      approval: approval(),
      currentTime: now,
    };

    const zero = await runTasksListVerticalSlice({
      ...base,
      tasks: [{ id: "done", title: "Done", completed: true }],
    }, { now: () => now });
    const one = await runTasksListVerticalSlice({
      ...base,
      tasks: [{ id: "one", title: "One", completed: false }],
    }, { now: () => now });
    const many = await runTasksListVerticalSlice({
      ...base,
      tasks: [
        { id: "one", title: "One", completed: false },
        { id: "two", title: "Two", completed: false },
        { id: "three", title: "Three", completed: false },
      ],
    }, { now: () => now });

    expect(zero.summary).toBe("No active tasks found.");
    expect(one.summary).toBe("1 active task found.");
    expect(many.summary).toBe("3 active tasks found.");
  });

  it("normalizes failure summary without exposing raw payloads", async () => {
    const failingHandler: AgentToolHandler = {
      toolId: "tasks.list",
      readOnly: true,
      timeoutMs: 1000,
      validateInput: () => ({ valid: true, errors: [] }),
      execute() {
        throw new Error("Sensitive stack trace.");
      },
    };
    const result = await runTasksListVerticalSlice({
      step: taskReviewStep(),
      resolution: resolution(),
      approval: approval(),
      tasks: [{ id: "secret", title: "Sensitive task title", completed: false }],
      currentTime: now,
    }, {
      now: () => now,
      getHandlerByToolId: () => failingHandler,
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toBe("The read-only task check could not run.");
    expect(result.summary).not.toContain("Sensitive task title");
    expect(result.summary).not.toContain("{");
  });

  it("does not run on unsupported or write-tool resolution", async () => {
    clearExecutionAuditRecords();
    const fakeWriteResolution: ToolResolutionResult = {
      ...resolution(),
      toolId: "tasks.create",
      resolved: true,
      status: "resolved",
    };
    const result = await runTasksListVerticalSlice({
      step: taskReviewStep(),
      resolution: fakeWriteResolution,
      approval: approval({ toolId: "tasks.create" }),
      tasks: [],
      currentTime: now,
      requestId: "request:write-not-run",
    });

    expect(result.status).toBe("denied");
    expect(getExecutionAuditRecordsByRequestId("request:write-not-run")).toEqual([]);
  });

  it("summary mapper never renders raw JSON", () => {
    const mapped = summarizeTasksListResult({
      requestId: "r",
      stepId: "s",
      toolId: "tasks.list",
      status: "success",
      success: true,
      data: { tasks: [{ title: "Safe title", status: "open" }] },
      policyDecision: {
        status: "allowed",
        allowed: true,
        reasons: [],
        effectiveRiskLevel: "none",
        requiredApprovalScope: "view_only",
        stepId: "s",
        evaluatedAt: now.toISOString(),
        policyVersion: "execution-policy-v1",
        checks: [],
      },
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      durationMs: 0,
      executionVersion: "execution-engine-v1",
      metadata: { readOnly: true, effectiveRiskLevel: "none" },
    });

    expect(mapped.summary).toBe("1 active task found.");
    expect(mapped.summary).not.toContain("{");
  });
});
