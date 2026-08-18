import { describe, expect, it } from "vitest";
import { synthesizeContext } from "./contextSynthesis";
import { getExecutionAuditRecordsByRequestId, clearExecutionAuditRecords } from "./executionAudit";
import { validateAgentIntentProposal } from "./reasoning/intentValidator";
import { composeAssistantResponse } from "./responseComposer";
import { runReadOnlyTool } from "./readOnlyRuntime";
import { getToolById } from "./toolRegistry";
import { resolveToolForStep } from "./toolResolver";
import type { WorkspacePlanStep } from "../workspace/workspaceTypes";

function step(): WorkspacePlanStep {
  return {
    id: "step:github-workflow-runs",
    order: 1,
    title: "Inspect recent GitHub workflow runs",
    description: "List bounded recent workflow-run status.",
    domain: "github",
    estimatedMinutes: 2,
    status: "proposed",
    actionType: "inspect",
    reason: "The user explicitly requested recent GitHub Actions status.",
    requiresApproval: false,
    dependencies: [],
    optional: false,
  };
}

const safeContext = {
  tasks: [],
  events: [],
  learningProgress: null,
};

describe("github.workflow_runs.list deterministic agent slice", () => {
  it("registers one enabled bounded read-only contract", () => {
    const tool = getToolById("github.workflow_runs.list");
    expect(tool).toMatchObject({
      domain: "github",
      capability: "read",
      mode: "read",
      riskLevel: "none",
      requiresApproval: false,
      approvalScope: "view_only",
      externalEffect: false,
      enabled: true,
    });
    expect(tool?.inputSchema).toEqual([]);
    expect(tool?.constraints.join(" ")).toContain("Excludes run logs");
  });

  it.each([
    ["en", "Check my GitHub Actions status."],
    ["de", "Zeige meine GitHub-Workflow-Laeufe."],
    ["fa", "اجراهای اخیر ورک‌فلوی گیت‌هاب را نشان بده."],
  ] as const)("validates the explicit %s GitHub workflow runs intent", (language, userMessage) => {
    const result = validateAgentIntentProposal({
      rawProposal: {
        type: "inspect_github_workflow_runs",
        confidence: "high",
        requestedDomain: "github",
        toolId: "github.workflow_runs.list",
      },
      userMessage,
      safeContext,
      language,
      now: new Date("2026-07-24T10:00:00.000Z"),
    });
    expect(result.proposal.type).toBe("inspect_github_workflow_runs");
    expect(result.toolId).toBe("github.workflow_runs.list");
    expect(result.proposal.requiresApproval).toBe(false);
  });

  it("does not resolve via the domain+actionType table alone: github.workflow_runs.list has no such mapping", () => {
    const resolution = resolveToolForStep({ step: step(), currentTime: new Date("2026-07-24T10:00:00Z") });
    expect(resolution.status).toBe("resolved");
    expect(resolution.toolId).toBe("github.repositories.list");
  });

  it("resolves via expectedToolId pass-through", () => {
    const resolution = resolveToolForStep({
      step: step(),
      expectedToolId: "github.workflow_runs.list",
      currentTime: new Date("2026-07-24T10:00:00Z"),
    });
    expect(resolution).toMatchObject({
      resolved: true,
      toolId: "github.workflow_runs.list",
      confidence: "high",
    });
  });

  it("runs through policy and the explicit read-only handler without approval", async () => {
    clearExecutionAuditRecords();
    const sourceStep = step();
    const resolution = resolveToolForStep({ step: sourceStep, expectedToolId: "github.workflow_runs.list" });
    const result = await runReadOnlyTool({
      requestId: "request:github-workflow-runs-list",
      step: sourceStep,
      toolResolution: resolution,
      approval: null,
      executionInput: {},
      executionContext: {
        githubWorkflowRunsClient: {
          async listWorkflowRuns() {
            return {
              connectionStatus: "connected" as const,
              workflowRuns: [
                { repo: "aryan/smartflow", workflowName: "CI", status: "completed", conclusion: "success", updatedAt: "2026-07-24T10:00:00.000Z" },
              ],
            };
          },
        },
      },
      currentTime: new Date("2026-07-24T10:00:00Z"),
    });
    expect(result).toMatchObject({ success: true, toolId: "github.workflow_runs.list" });
    expect(result.safeSummary).toBe("1 recent GitHub workflow run found.");
    expect(result.safePreviewItems).toEqual(["aryan/smartflow: CI (success)"]);
    const audit = getExecutionAuditRecordsByRequestId("request:github-workflow-runs-list");
    expect(audit.map((record) => record.status)).toEqual(["started", "success"]);
    expect(JSON.stringify(audit)).not.toMatch(/token|authorization/i);
  });

  it("returns a safe not-connected result instead of synthesizing provider data", async () => {
    const sourceStep = step();
    const result = await runReadOnlyTool({
      requestId: "request:github-workflow-runs-not-connected",
      step: sourceStep,
      toolResolution: resolveToolForStep({ step: sourceStep, expectedToolId: "github.workflow_runs.list" }),
      executionInput: {},
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.safeSummary).toBe("No GitHub connection is available.");
    expect(result.safePreviewItems).toEqual([]);
  });

  it("synthesizes only bounded GitHub evidence and composes en/de/fa responses", () => {
    const synthesized = synthesizeContext({
      toolId: "github.workflow_runs.list",
      executionStatus: "success",
      safeRuntimeSummary: "2 recent GitHub workflow runs found.",
      safePreviewItems: ["owner/repo: CI (success)", "owner/repo: Deploy (failure)"],
      responseLanguage: "en",
      generatedAt: "2026-07-24T10:00:00.000Z",
    });
    expect(synthesized.evidenceDomains).toEqual(["github"]);
    expect(synthesized.primaryFact).toBe("2 recent GitHub workflow runs found.");

    const english = composeAssistantResponse({
      toolId: "github.workflow_runs.list",
      language: "en",
      success: true,
      safeSummary: "2 recent GitHub workflow runs found.",
      safePreviewItems: ["owner/repo: CI (success)", "owner/repo: Deploy (failure)"],
      synthesizedContext: synthesized,
    });
    const german = composeAssistantResponse({ ...englishInput("de"), synthesizedContext: undefined });
    const persian = composeAssistantResponse({ ...englishInput("fa"), synthesizedContext: undefined });
    expect(english.headline).toContain("GitHub workflow runs");
    expect(german.headline).toContain("GitHub-Workflow-Laeufe");
    expect(persian.headline).toContain("گیت‌هاب");
  });
});

function englishInput(language: "de" | "fa") {
  return {
    toolId: "github.workflow_runs.list",
    language,
    success: true,
    safeSummary: "2 recent GitHub workflow runs found.",
    safePreviewItems: ["owner/repo: CI (success)", "owner/repo: Deploy (failure)"],
  } as const;
}
