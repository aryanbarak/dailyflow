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
    id: "step:github-pulls",
    order: 1,
    title: "Inspect open GitHub pull requests",
    description: "List bounded open-pull-request metadata.",
    domain: "github",
    estimatedMinutes: 2,
    status: "proposed",
    actionType: "inspect",
    reason: "The user explicitly requested open GitHub pull requests.",
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

describe("github.pulls.list deterministic agent slice", () => {
  it("registers one enabled bounded read-only contract", () => {
    const tool = getToolById("github.pulls.list");
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
    expect(tool?.constraints.join(" ")).toContain("Excludes issues");
  });

  it.each([
    ["en", "Show my open pull requests."],
    ["de", "Zeige meine Pull-Requests."],
    ["fa", "پول‌ریکوئست‌های باز گیت‌هاب را نشان بده."],
  ] as const)("validates the explicit %s GitHub pull requests intent", (language, userMessage) => {
    const result = validateAgentIntentProposal({
      rawProposal: {
        type: "inspect_github_pull_requests",
        confidence: "high",
        requestedDomain: "github",
        toolId: "github.pulls.list",
      },
      userMessage,
      safeContext,
      language,
      now: new Date("2026-07-24T10:00:00.000Z"),
    });
    expect(result.proposal.type).toBe("inspect_github_pull_requests");
    expect(result.toolId).toBe("github.pulls.list");
    expect(result.proposal.requiresApproval).toBe(false);
  });

  it("does not resolve via the domain+actionType table alone: github.pulls.list has no such mapping", () => {
    const resolution = resolveToolForStep({ step: step(), currentTime: new Date("2026-07-24T10:00:00Z") });
    expect(resolution.status).toBe("resolved");
    expect(resolution.toolId).toBe("github.repositories.list");
  });

  it("resolves via expectedToolId pass-through", () => {
    const resolution = resolveToolForStep({
      step: step(),
      expectedToolId: "github.pulls.list",
      currentTime: new Date("2026-07-24T10:00:00Z"),
    });
    expect(resolution).toMatchObject({
      resolved: true,
      toolId: "github.pulls.list",
      confidence: "high",
    });
  });

  it("runs through policy and the explicit read-only handler without approval", async () => {
    clearExecutionAuditRecords();
    const sourceStep = step();
    const resolution = resolveToolForStep({ step: sourceStep, expectedToolId: "github.pulls.list" });
    const result = await runReadOnlyTool({
      requestId: "request:github-pulls-list",
      step: sourceStep,
      toolResolution: resolution,
      approval: null,
      executionInput: {},
      executionContext: {
        githubPullRequestsClient: {
          async listPullRequests() {
            return {
              connectionStatus: "connected" as const,
              pullRequests: [
                { repo: "aryan/smartflow", number: 7, title: "Add pulls tool", state: "open" as const, updatedAt: "2026-07-24T10:00:00.000Z", draft: false },
              ],
            };
          },
        },
      },
      currentTime: new Date("2026-07-24T10:00:00Z"),
    });
    expect(result).toMatchObject({ success: true, toolId: "github.pulls.list" });
    expect(result.safeSummary).toBe("1 open GitHub pull request found.");
    expect(result.safePreviewItems).toEqual(["aryan/smartflow#7 Add pulls tool"]);
    const audit = getExecutionAuditRecordsByRequestId("request:github-pulls-list");
    expect(audit.map((record) => record.status)).toEqual(["started", "success"]);
    expect(JSON.stringify(audit)).not.toMatch(/token|authorization/i);
  });

  it("returns a safe not-connected result instead of synthesizing provider data", async () => {
    const sourceStep = step();
    const result = await runReadOnlyTool({
      requestId: "request:github-pulls-not-connected",
      step: sourceStep,
      toolResolution: resolveToolForStep({ step: sourceStep, expectedToolId: "github.pulls.list" }),
      executionInput: {},
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.safeSummary).toBe("No GitHub connection is available.");
    expect(result.safePreviewItems).toEqual([]);
  });

  it("synthesizes only bounded GitHub evidence and composes en/de/fa responses", () => {
    const synthesized = synthesizeContext({
      toolId: "github.pulls.list",
      executionStatus: "success",
      safeRuntimeSummary: "2 open GitHub pull requests found.",
      safePreviewItems: ["owner/repo#1 First PR", "owner/repo#2 Second PR"],
      responseLanguage: "en",
      generatedAt: "2026-07-24T10:00:00.000Z",
    });
    expect(synthesized.evidenceDomains).toEqual(["github"]);
    expect(synthesized.primaryFact).toBe("2 open GitHub pull requests found.");

    const english = composeAssistantResponse({
      toolId: "github.pulls.list",
      language: "en",
      success: true,
      safeSummary: "2 open GitHub pull requests found.",
      safePreviewItems: ["owner/repo#1 First PR", "owner/repo#2 Second PR"],
      synthesizedContext: synthesized,
    });
    const german = composeAssistantResponse({ ...englishInput("de"), synthesizedContext: undefined });
    const persian = composeAssistantResponse({ ...englishInput("fa"), synthesizedContext: undefined });
    expect(english.headline).toContain("GitHub pull requests");
    expect(german.headline).toContain("GitHub-Pull-Requests");
    expect(persian.headline).toContain("گیت‌هاب");
  });
});

function englishInput(language: "de" | "fa") {
  return {
    toolId: "github.pulls.list",
    language,
    success: true,
    safeSummary: "2 open GitHub pull requests found.",
    safePreviewItems: ["owner/repo#1 First PR", "owner/repo#2 Second PR"],
  } as const;
}
