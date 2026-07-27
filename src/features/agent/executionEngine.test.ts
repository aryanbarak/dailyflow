import { describe, expect, it } from "vitest";
import {
  clearExecutionRecords,
  executeAgentTool,
  getExecutionRecords,
} from "./executionEngine";
import { listRegisteredHandlers } from "./handlers";
import { getToolById } from "./toolRegistry";
import type {
  AgentToolHandler,
  ExecutionContext,
  ExecutionRequest,
} from "./executionTypes";
import type { AgentToolDefinition } from "./toolTypes";
import type {
  WorkspaceApprovalRiskLevel,
  WorkspacePlanActionType,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

const now = new Date("2026-07-10T09:00:00.000Z");

function fixedDeps(overrides: Partial<Parameters<typeof executeAgentTool>[1]> = {}) {
  return {
    now: () => now,
    ...overrides,
  };
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
    requiresApproval: false,
    dependencies: [],
    optional: false,
    ...overrides,
  };
}

function approval(
  riskLevel: WorkspaceApprovalRiskLevel = "medium",
  stepId = "step-1",
  toolId = "tasks.create",
): WorkspaceStepApproval {
  return {
    stepId,
    toolId,
    status: "approved",
    requiresApproval: true,
    approvalReason: "Approved by user in a future approval flow.",
    riskLevel,
    reversible: riskLevel !== "high",
    externalEffect: riskLevel !== "none",
    dataDomains: ["tasks"],
    approvalScope: "single_step",
  };
}

function request(
  toolId: string,
  actionType: WorkspacePlanActionType,
  context: ExecutionContext = {},
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return {
    requestId: `request:${toolId}`,
    step: step(actionType),
    toolId,
    input: {},
    requestedAt: now.toISOString(),
    context,
    ...overrides,
  };
}

describe("executionEngine", () => {
  it("executes tasks.list successfully", async () => {
    clearExecutionRecords();
    const result = await executeAgentTool(
      request("tasks.list", "review", {
        tasks: [
          { id: "task-1", title: "Review invoices", completed: false, priority: "high" },
          { id: "task-2", title: "Done item", completed: true },
        ],
      }),
      fixedDeps(),
    );

    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      tasks: [
        {
          id: "task-1",
          title: "Review invoices",
          status: "open",
          priority: "high",
          dueDate: undefined,
        },
        {
          id: "task-2",
          title: "Done item",
          status: "completed",
          priority: undefined,
          dueDate: undefined,
        },
      ],
    });
  });

  it("executes calendar.list_today successfully", async () => {
    const result = await executeAgentTool(
      request("calendar.list_today", "review", {
        currentTime: now.toISOString(),
        events: [
          { id: "event-1", title: "Standup", dateTimeStart: "2026-07-10T08:00:00.000Z" },
          { id: "event-2", title: "Tomorrow", dateTimeStart: "2026-07-11T08:00:00.000Z" },
        ],
      }, {
        step: step("review", { domain: "calendar" }),
      }),
      fixedDeps(),
    );

    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      events: [
        {
          id: "event-1",
          title: "Standup",
          start: "2026-07-10T08:00:00.000Z",
          end: undefined,
          location: undefined,
        },
      ],
    });
  });

  it("executes learning.get_progress successfully", async () => {
    const result = await executeAgentTool(
      request("learning.get_progress", "review", {
        learningProgress: {
          totalQuestions: 21,
          mode: "Algorithms",
          lessons: [
            {
              id: "lesson-1",
              title: "Sorting Algorithms",
              completionPercentage: 82,
              completed: false,
              lastActivityAt: now.toISOString(),
            },
          ],
        },
      }, {
        step: step("review", { domain: "learning" }),
      }),
      fixedDeps(),
    );

    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      lessons: [
        {
          id: "lesson-1",
          title: "Sorting Algorithms",
          completionPercentage: 82,
          completed: false,
          lastActivityAt: now.toISOString(),
        },
      ],
      totalQuestions: 21,
      lastActivityAt: undefined,
      mode: "Algorithms",
    });
  });

  it("executes workspace.get_context successfully", async () => {
    const result = await executeAgentTool(
      request("workspace.get_context", "review", {
        workspace: {
          goal: {
            title: "Clear active work",
            summary: "Focus on the active task list.",
            primaryDomain: "tasks",
            supportingDomains: ["calendar"],
            confidence: "high",
          },
          plan: {
            title: "Plan",
            summary: "Review and focus.",
            steps: [{ id: "a" }, { id: "b" }],
            totalEstimatedMinutes: 45,
            confidence: "high",
          },
          signalFeed: [
            {
              id: "tasks:many-open",
              domain: "tasks",
              label: "Many open tasks",
              severity: "high",
              reason: "Several tasks are open.",
              count: 8,
            },
          ],
        } as never,
      }, {
        step: step("review", { domain: "workspace" as never }),
      }),
      fixedDeps(),
    );

    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      workspace: {
        goal: {
          title: "Clear active work",
          summary: "Focus on the active task list.",
          primaryDomain: "tasks",
          supportingDomains: ["calendar"],
          confidence: "high",
        },
        plan: {
          title: "Plan",
          summary: "Review and focus.",
          stepCount: 2,
          totalEstimatedMinutes: 45,
          confidence: "high",
        },
        priority: {
          primaryDomain: "tasks",
          secondaryDomains: ["calendar"],
          confidence: "high",
        },
        signals: [
          {
            id: "tasks:many-open",
            domain: "tasks",
            label: "Many open tasks",
            severity: "high",
            reason: "Several tasks are open.",
            count: 8,
          },
        ],
      },
    });
  });

  it("prevents handler resolution when policy denies", async () => {
    let handlerResolved = false;
    const result = await executeAgentTool(
      request("tasks.create", "create"),
      fixedDeps({
        getHandlerByToolId: () => {
          handlerResolved = true;
          return undefined;
        },
      }),
    );

    expect(result.status).toBe("policy_denied");
    expect(handlerResolved).toBe(false);
  });

  it("returns tool_not_found for unknown tools", async () => {
    const result = await executeAgentTool(
      request("unknown.tool", "review"),
      fixedDeps(),
    );

    expect(result.status).toBe("tool_not_found");
    expect(result.error?.code).toBe("TOOL_NOT_FOUND");
  });

  it("returns handler_not_found for registered tools without handlers", async () => {
    const result = await executeAgentTool(
      request("documents.list_recent", "review", {}, {
        step: step("review", { domain: "documents" }),
      }),
      fixedDeps(),
    );

    expect(result.status).toBe("handler_not_found");
    expect(result.error?.code).toBe("HANDLER_NOT_FOUND");
  });

  it("does not execute disabled tools", async () => {
    const disabledTool = {
      ...(getToolById("tasks.list") as AgentToolDefinition),
      enabled: false,
    };
    const result = await executeAgentTool(
      request("tasks.list", "review"),
      fixedDeps({
        getToolById: () => disabledTool,
      }),
    );

    expect(result.status).toBe("policy_denied");
    expect(result.policyDecision.status).toBe("tool_disabled");
  });

  it("returns invalid_input for schema validation failures", async () => {
    const result = await executeAgentTool(
      request("tasks.list", "review", {}, { input: null as never }),
      fixedDeps(),
    );

    expect(result.status).toBe("invalid_input");
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  it("normalizes handler errors as failed", async () => {
    const failingHandler: AgentToolHandler = {
      ...listRegisteredHandlers()[0],
      execute() {
        throw new Error("Sensitive stack should not escape.");
      },
    };

    const result = await executeAgentTool(
      request("tasks.list", "review"),
      fixedDeps({
        getHandlerByToolId: () => failingHandler,
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "HANDLER_FAILED",
      message: "Handler execution failed.",
      retryable: false,
    });
  });

  it("returns timeout for slow handlers", async () => {
    const slowHandler: AgentToolHandler = {
      ...listRegisteredHandlers()[0],
      timeoutMs: 1,
      execute() {
        return new Promise(() => undefined);
      },
    };

    const result = await executeAgentTool(
      request("tasks.list", "review"),
      fixedDeps({
        getHandlerByToolId: () => slowHandler,
      }),
    );

    expect(result.status).toBe("timeout");
    expect(result.error?.retryable).toBe(true);
  });

  it("does not execute write tools even with approval and accidental handler", async () => {
    const accidentalHandler: AgentToolHandler = {
      ...listRegisteredHandlers()[0],
      toolId: "tasks.create",
      execute() {
        return { created: true };
      },
    };

    const result = await executeAgentTool(
      request("tasks.create", "create", {}, { approval: approval("medium") }),
      fixedDeps({
        getHandlerByToolId: () => accidentalHandler,
      }),
    );

    expect(result.status).toBe("handler_not_found");
    expect(result.success).toBe(false);
  });

  it("does not execute external-effect tools", async () => {
    const accidentalHandler: AgentToolHandler = {
      ...listRegisteredHandlers()[0],
      toolId: "finance.create_transaction",
      execute() {
        return { created: true };
      },
    };

    const result = await executeAgentTool(
      request("finance.create_transaction", "pay", {}, {
        step: step("pay", { domain: "finance" }),
        approval: approval("high", "step-1", "finance.create_transaction"),
      }),
      fixedDeps({
        getHandlerByToolId: () => accidentalHandler,
      }),
    );

    expect(result.status).toBe("handler_not_found");
    expect(result.success).toBe(false);
  });

  it("creates bounded execution records without payloads", async () => {
    clearExecutionRecords();

    for (let index = 0; index < 105; index += 1) {
      await executeAgentTool(
        request("tasks.list", "review", {}, { requestId: `request-${index}` }),
        fixedDeps(),
      );
    }

    const records = getExecutionRecords();
    expect(records).toHaveLength(100);
    expect(records[0].requestId).toBe("request-5");
    expect(records[99].requestId).toBe("request-104");
    expect(records.some((record) => "input" in record || "data" in record)).toBe(false);
  });

  it("is deterministic for identical safe input", async () => {
    clearExecutionRecords();
    const sourceRequest = request("tasks.list", "review", {
      tasks: [{ id: "task-1", title: "Review invoices", completed: false }],
    });
    const before = JSON.stringify(sourceRequest);

    const first = await executeAgentTool(sourceRequest, fixedDeps());
    clearExecutionRecords();
    const second = await executeAgentTool(sourceRequest, fixedDeps());

    expect(second).toEqual(first);
    expect(JSON.stringify(sourceRequest)).toBe(before);
  });

  it("keeps the handler registry explicit and immutable", () => {
    const handlers = listRegisteredHandlers();

    expect(Object.isFrozen(handlers)).toBe(true);
    expect(handlers.map((handler) => handler.toolId)).toEqual([
      "tasks.list",
      "calendar.list_today",
      "learning.get_progress",
      "workspace.get_context",
      "github.repositories.list",
      "github.issues.list",
      "github.epics.list",
      "github.pulls.list",
      "github.workflow_runs.list",
    ]);
  });
});
