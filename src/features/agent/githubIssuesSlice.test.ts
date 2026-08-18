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
    id: "step:github-issues",
    order: 1,
    title: "Inspect open GitHub issues",
    description: "List bounded open-issue metadata.",
    domain: "github",
    estimatedMinutes: 2,
    status: "proposed",
    actionType: "inspect",
    reason: "The user explicitly requested open GitHub issues.",
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

describe("github.issues.list deterministic agent slice", () => {
  it("registers one enabled bounded read-only contract", () => {
    const tool = getToolById("github.issues.list");
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
    expect(tool?.constraints.join(" ")).toContain("Excludes pull requests");
  });

  it.each([
    ["en", "Show my open GitHub issues."],
    ["de", "Zeige meine GitHub-Issues."],
    ["fa", "ایشوهای باز گیت‌هاب را نشان بده."],
  ] as const)("validates the explicit %s GitHub issues intent", (language, userMessage) => {
    const result = validateAgentIntentProposal({
      rawProposal: {
        type: "inspect_github_issues",
        confidence: "high",
        requestedDomain: "github",
        toolId: "github.issues.list",
      },
      userMessage,
      safeContext,
      language,
      now: new Date("2026-07-22T10:00:00.000Z"),
    });
    expect(result.proposal.type).toBe("inspect_github_issues");
    expect(result.toolId).toBe("github.issues.list");
    expect(result.proposal.requiresApproval).toBe(false);
  });

  it("does not resolve via the domain+actionType table alone: github.issues.list has no such mapping", () => {
    // Deliberate: per the resolver pass-through decision, github.issues.list
    // (and any future github read tool) is not given its own actionType.
    // Resolution only works when the caller supplies expectedToolId.
    const resolution = resolveToolForStep({ step: step(), currentTime: new Date("2026-07-22T10:00:00Z") });
    expect(resolution.status).toBe("resolved");
    expect(resolution.toolId).toBe("github.repositories.list");
  });

  it("resolves via expectedToolId pass-through", () => {
    const resolution = resolveToolForStep({
      step: step(),
      expectedToolId: "github.issues.list",
      currentTime: new Date("2026-07-22T10:00:00Z"),
    });
    expect(resolution).toMatchObject({
      resolved: true,
      toolId: "github.issues.list",
      confidence: "high",
    });
  });

  it("runs through policy and the explicit read-only handler without approval", async () => {
    clearExecutionAuditRecords();
    const sourceStep = step();
    const resolution = resolveToolForStep({ step: sourceStep, expectedToolId: "github.issues.list" });
    const result = await runReadOnlyTool({
      requestId: "request:github-issues-list",
      step: sourceStep,
      toolResolution: resolution,
      approval: null,
      executionInput: {},
      executionContext: {
        githubIssuesClient: {
          async listIssues() {
            return {
              connectionStatus: "connected" as const,
              issues: [
                { repo: "aryan/smartflow", number: 42, title: "Fix reasoning rescue", state: "open" as const, updatedAt: "2026-07-20T10:00:00.000Z" },
              ],
            };
          },
        },
      },
      currentTime: new Date("2026-07-22T10:00:00Z"),
    });
    expect(result).toMatchObject({ success: true, toolId: "github.issues.list" });
    expect(result.safeSummary).toBe("1 open GitHub issue found.");
    expect(result.safePreviewItems).toEqual(["aryan/smartflow#42 Fix reasoning rescue"]);
    const audit = getExecutionAuditRecordsByRequestId("request:github-issues-list");
    expect(audit.map((record) => record.status)).toEqual(["started", "success"]);
    expect(JSON.stringify(audit)).not.toMatch(/token|authorization/i);
  });

  it("returns a safe not-connected result instead of synthesizing provider data", async () => {
    const sourceStep = step();
    const result = await runReadOnlyTool({
      requestId: "request:github-issues-not-connected",
      step: sourceStep,
      toolResolution: resolveToolForStep({ step: sourceStep, expectedToolId: "github.issues.list" }),
      executionInput: {},
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.safeSummary).toBe("No GitHub connection is available.");
    expect(result.safePreviewItems).toEqual([]);
  });

  it("synthesizes only bounded GitHub evidence and composes en/de/fa responses", () => {
    const synthesized = synthesizeContext({
      toolId: "github.issues.list",
      executionStatus: "success",
      safeRuntimeSummary: "2 open GitHub issues found.",
      safePreviewItems: ["owner/repo#1 First issue", "owner/repo#2 Second issue"],
      responseLanguage: "en",
      generatedAt: "2026-07-22T10:00:00.000Z",
    });
    expect(synthesized.evidenceDomains).toEqual(["github"]);
    expect(synthesized.primaryFact).toBe("2 open GitHub issues found.");

    const english = composeAssistantResponse({
      toolId: "github.issues.list",
      language: "en",
      success: true,
      safeSummary: "2 open GitHub issues found.",
      safePreviewItems: ["owner/repo#1 First issue", "owner/repo#2 Second issue"],
      synthesizedContext: synthesized,
    });
    const german = composeAssistantResponse({ ...englishInput("de"), synthesizedContext: undefined });
    const persian = composeAssistantResponse({ ...englishInput("fa"), synthesizedContext: undefined });
    expect(english.headline).toContain("GitHub issues");
    expect(german.headline).toContain("GitHub-Issues");
    expect(persian.headline).toContain("گیت‌هاب");
  });
});

function englishInput(language: "de" | "fa") {
  return {
    toolId: "github.issues.list",
    language,
    success: true,
    safeSummary: "2 open GitHub issues found.",
    safePreviewItems: ["owner/repo#1 First issue", "owner/repo#2 Second issue"],
  } as const;
}
