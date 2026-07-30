import { describe, expect, it } from "vitest";
import {
  clearExecutionAuditRecords,
  getExecutionAuditRecordsByRequestId,
} from "./executionAudit";
import { approveWorkspaceStep } from "./approvalInteraction";
import { getToolById } from "./toolRegistry";
import { canStartReadOnlyRun, runReadOnlyTool } from "./readOnlyRuntime";
import type { AgentToolHandler } from "./executionTypes";
import type { ToolResolutionResult } from "./toolResolverTypes";
import type {
  WorkspacePlanActionType,
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "../workspace/workspaceTypes";

const now = new Date("2026-07-10T09:00:00.000Z");

function step(
  toolId: string,
  overrides: Partial<WorkspacePlanStep> = {},
): WorkspacePlanStep {
  const domain = toolId.split(".")[0] === "workspace"
    ? "workspace"
    : toolId.split(".")[0];

  return {
    id: `step:${toolId}`,
    order: 1,
    title: `Run ${toolId}`,
    description: `Review ${toolId}.`,
    domain: domain as WorkspacePlanStep["domain"],
    estimatedMinutes: 5,
    status: "proposed",
    actionType: "review",
    reason: "Read-only review.",
    requiresApproval: false,
    dependencies: [],
    optional: false,
    ...overrides,
  };
}

function resolution(
  toolId: string,
  sourceStep = step(toolId),
  overrides: Partial<ToolResolutionResult> = {},
): ToolResolutionResult {
  return {
    status: "resolved",
    resolved: true,
    stepId: sourceStep.id,
    toolId,
    tool: getToolById(toolId),
    confidence: "high",
    reasons: ["Resolved for test."],
    candidates: [],
    requiredInput: [],
    generatedAt: now.toISOString(),
    resolverVersion: "tool-resolver-v1",
    ...overrides,
  };
}

function approval(
  sourceStep: WorkspacePlanStep,
  overrides: Partial<WorkspaceStepApproval> = {},
): WorkspaceStepApproval {
  return {
    stepId: sourceStep.id,
    toolId: "tasks.list",
    status: "not_required",
    requiresApproval: false,
    approvalReason: "Read-only or reflective step; no approval required.",
    riskLevel: "none",
    reversible: true,
    externalEffect: false,
    dataDomains: [sourceStep.domain],
    approvalScope: "view_only",
    ...overrides,
  };
}

describe("readOnlyRuntime", () => {
  it("executes tasks.list through the existing execution engine and audit", async () => {
    clearExecutionAuditRecords();
    const sourceStep = step("tasks.list");
    const result = await runReadOnlyTool({
      requestId: "request:runtime:tasks",
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep),
      approval: approval(sourceStep),
      executionContext: {
        tasks: [
          { id: "task-1", title: "Review invoices", completed: false },
          { id: "task-2", title: "Done", completed: true },
        ],
      },
      currentTime: now,
    }, { now: () => now });

    expect(result.status).toBe("success");
    expect(result.safeSummary).toBe("1 active task found.");
    expect(result.safePreviewItems).toEqual(["Review invoices"]);
    expect(getExecutionAuditRecordsByRequestId("request:runtime:tasks").map((record) => record.status)).toEqual([
      "started",
      "success",
    ]);
  });

  it("executes calendar.list_today, learning.get_progress, and workspace.get_context", async () => {
    const calendarStep = step("calendar.list_today", { domain: "calendar" });
    const learningStep = step("learning.get_progress", { domain: "learning" });
    const workspaceStep = step("workspace.get_context", { domain: "workspace" as never });

    const calendar = await runReadOnlyTool({
      step: calendarStep,
      toolResolution: resolution("calendar.list_today", calendarStep),
      executionContext: {
        currentTime: now.toISOString(),
        events: [{ id: "event-1", title: "Standup", dateTimeStart: now.toISOString() }],
      },
      currentTime: now,
    }, { now: () => now });
    const learning = await runReadOnlyTool({
      step: learningStep,
      toolResolution: resolution("learning.get_progress", learningStep),
      executionContext: {
        learningProgress: {
          lessons: [{ id: "lesson-1", title: "Sorting", completionPercentage: 82 }],
        },
      },
      currentTime: now,
    }, { now: () => now });
    const workspace = await runReadOnlyTool({
      step: workspaceStep,
      toolResolution: resolution("workspace.get_context", workspaceStep),
      executionContext: {
        workspace: {
          goal: {
            title: "Clear active work",
            summary: "Focus.",
            primaryDomain: "tasks",
            supportingDomains: [],
            confidence: "high",
          },
          plan: {
            steps: [],
            totalEstimatedMinutes: 0,
            confidence: "high",
          },
          signalFeed: [],
        } as never,
      },
      currentTime: now,
    }, { now: () => now });

    expect(calendar.safeSummary).toBe("1 event found today.");
    expect(learning.safeSummary).toBe("1 learning item found.");
    expect(workspace.safeSummary).toBe("Workspace context loaded.");
  });

  it("executes github.repositories.list through the canonical execution intent lifecycle", async () => {
    const sourceStep = step("github.repositories.list", { domain: "github", actionType: "inspect" });
    const result = await runReadOnlyTool({
      requestId: "request:runtime:github-repositories",
      step: sourceStep,
      toolResolution: resolution("github.repositories.list", sourceStep),
      executionContext: {
        githubRepositoriesClient: {
          listRepositories: async () => ({
            connectionStatus: "connected",
            repositories: [{
              id: "repo-1",
              name: "smartflow",
              owner: "aryan",
              visibility: "private",
              defaultBranch: "main",
              archived: false,
            }],
          }),
        },
      },
      currentTime: now,
    }, { now: () => now });

    expect(result.status).toBe("success");
    expect(result.executionResult?.metadata.executionIntent).toMatchObject({
      intentId: expect.stringMatching(/^intent:/),
      canonicalHash: expect.any(String),
      attemptId: "request:runtime:github-repositories",
      resultStatus: "succeeded",
    });
  });

  it("blocks github.repositories.list when canonicalization fails without a legacy fallback", async () => {
    const sourceStep = step("github.repositories.list", { domain: "github", actionType: "inspect" });
    let handlerCalled = false;
    const result = await runReadOnlyTool({
      requestId: "request:runtime:github-repositories:bad",
      step: sourceStep,
      toolResolution: resolution("github.repositories.list", sourceStep),
      executionInput: { unexpected: "client-field" },
      currentTime: now,
    }, {
      now: () => now,
      getHandlerByToolId: () => {
        handlerCalled = true;
        return undefined;
      },
    });

    expect(result.status).toBe("policy_denied");
    expect(result.safeSummary).toBe("Run blocked by execution intent lifecycle.");
    expect(handlerCalled).toBe(false);
  });

  it("rejects unsupported and write tools before handler resolution", async () => {
    let handlerResolved = false;
    const writeStep = step("tasks.create", { actionType: "create" as WorkspacePlanActionType });
    const result = await runReadOnlyTool({
      step: writeStep,
      toolResolution: resolution("tasks.create", writeStep),
      currentTime: now,
    }, {
      now: () => now,
      getHandlerByToolId: () => {
        handlerResolved = true;
        return undefined;
      },
    });

    expect(result.status).toBe("unresolved");
    expect(handlerResolved).toBe(false);
  });

  it("rejects tasks.complete before handler resolution because it is outside the read-only runtime", async () => {
    let handlerResolved = false;
    const completeStep = step("tasks.complete", {
      actionType: "complete" as WorkspacePlanActionType,
      targetId: "task-1",
      requiresApproval: true,
    });
    const result = await runReadOnlyTool({
      step: completeStep,
      toolResolution: resolution("tasks.complete", completeStep),
      approval: approval(completeStep, {
        status: "approved",
        requiresApproval: true,
        approvalScope: "single_step",
        riskLevel: "medium",
        externalEffect: true,
        toolId: "tasks.complete",
      }),
      currentTime: now,
    }, {
      now: () => now,
      getHandlerByToolId: () => {
        handlerResolved = true;
        return undefined;
      },
    });

    expect(result.status).toBe("unresolved");
    expect(result.reasons).toContain("The resolved tool is outside the read-only runtime boundary.");
    expect(handlerResolved).toBe(false);
  });

  it("stops unresolved steps safely", async () => {
    const sourceStep = step("tasks.list");
    const result = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep, { resolved: false, status: "unresolved" }),
      currentTime: now,
    });

    expect(result.status).toBe("unresolved");
    expect(result.success).toBe(false);
  });

  it("requires explicit approval when the step requires approval", async () => {
    const sourceStep = step("tasks.list", { requiresApproval: true });
    const result = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep),
      approval: approval(sourceStep, { status: "pending", requiresApproval: true, approvalScope: "single_step" }),
      currentTime: now,
    });

    expect(result.status).toBe("approval_required");
  });

  it("approval alone does not execute", async () => {
    clearExecutionAuditRecords();
    const sourceStep = step("tasks.list", { requiresApproval: true });
    const approved = await approveWorkspaceStep({
      now,
      step: sourceStep,
      stepApproval: approval(sourceStep, {
        status: "pending",
        requiresApproval: true,
        approvalScope: "single_step",
      }),
      tool: getToolById("tasks.list"),
    });

    expect(approved.ok).toBe(true);
    expect(getExecutionAuditRecordsByRequestId("request:not-created")).toEqual([]);
  });

  it("rejected approval stops before execution", async () => {
    const sourceStep = step("tasks.list");
    const result = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep),
      approval: approval(sourceStep, { status: "rejected" }),
      currentTime: now,
    });

    expect(result.status).toBe("rejected");
    expect(result.executionResult).toBeUndefined();
  });

  it("wrong-step and wrong-tool approval stop through policy", async () => {
    const sourceStep = step("tasks.list");
    const wrongStep = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep),
      approval: approval(sourceStep, { stepId: "wrong-step" }),
      currentTime: now,
    }, { now: () => now });
    const wrongTool = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep),
      approval: approval(sourceStep, { toolId: "tasks.create" }),
      currentTime: now,
    }, { now: () => now });

    expect(wrongStep.status).toBe("policy_denied");
    expect(wrongTool.status).toBe("policy_denied");
  });

  it("policy denial prevents handler invocation", async () => {
    let handlerResolved = false;
    const sourceStep = step("tasks.list");
    const result = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep),
      currentTime: now,
    }, {
      now: () => now,
      getToolById: () => ({ ...(getToolById("tasks.list") as never), enabled: false }),
      getHandlerByToolId: () => {
        handlerResolved = true;
        return undefined;
      },
    });

    expect(result.status).toBe("policy_denied");
    expect(handlerResolved).toBe(false);
  });

  it("maps timeout and handler failure safely", async () => {
    const sourceStep = step("tasks.list");
    const slowHandler: AgentToolHandler = {
      toolId: "tasks.list",
      readOnly: true,
      timeoutMs: 1,
      validateInput: () => ({ valid: true, errors: [] }),
      execute: () => new Promise(() => undefined),
    };
    const failingHandler: AgentToolHandler = {
      ...slowHandler,
      timeoutMs: 1000,
      execute: () => {
        throw new Error("Sensitive stack");
      },
    };

    const timeout = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep),
      currentTime: now,
    }, { now: () => now, getHandlerByToolId: () => slowHandler });
    const failed = await runReadOnlyTool({
      step: sourceStep,
      toolResolution: resolution("tasks.list", sourceStep),
      currentTime: now,
    }, { now: () => now, getHandlerByToolId: () => failingHandler });

    expect(timeout.status).toBe("timeout");
    expect(failed.status).toBe("failed");
    expect(failed.safeSummary).not.toContain("Sensitive");
  });

  it("prevents duplicate execution state and does not mutate inputs", async () => {
    expect(canStartReadOnlyRun("ready")).toBe(true);
    expect(canStartReadOnlyRun("running")).toBe(false);

    const sourceStep = step("tasks.list");
    const sourceResolution = resolution("tasks.list", sourceStep);
    const sourceRequest = {
      step: sourceStep,
      toolResolution: sourceResolution,
      executionContext: {
        tasks: [{ id: "task-1", title: "Task", completed: false }],
      },
      currentTime: now,
    };
    const before = JSON.stringify(sourceRequest);

    await runReadOnlyTool(sourceRequest, { now: () => now });

    expect(JSON.stringify(sourceRequest)).toBe(before);
  });
});
