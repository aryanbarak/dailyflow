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
    id: "step:github-repositories",
    order: 1,
    title: "Inspect connected GitHub repositories",
    description: "List bounded connected repository metadata.",
    domain: "github",
    estimatedMinutes: 2,
    status: "proposed",
    actionType: "inspect",
    reason: "The user explicitly requested connected GitHub repositories.",
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

describe("github.repositories.list deterministic agent slice", () => {
  it("registers one enabled bounded read-only contract", () => {
    const tool = getToolById("github.repositories.list");
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
    expect(tool?.constraints.join(" ")).toContain("Does not accept installation IDs");
  });

  it.each([
    ["en", "Show my connected GitHub repositories."],
    ["de", "Zeige meine verbundenen GitHub-Repositories."],
    ["fa", "مخزن‌های متصل گیت‌هاب را نشان بده."],
  ] as const)("validates the explicit %s GitHub repository intent", (language, userMessage) => {
    const result = validateAgentIntentProposal({
      rawProposal: {
        type: "inspect_github_repositories",
        confidence: "high",
        requestedDomain: "github",
        toolId: "github.repositories.list",
      },
      userMessage,
      safeContext,
      language,
      now: new Date("2026-07-22T10:00:00.000Z"),
    });
    expect(result.proposal.type).toBe("inspect_github_repositories");
    expect(result.toolId).toBe("github.repositories.list");
    expect(result.proposal.requiresApproval).toBe(false);
  });

  it("resolves only the explicit GitHub inspect mapping", () => {
    const resolution = resolveToolForStep({ step: step(), currentTime: new Date("2026-07-22T10:00:00Z") });
    expect(resolution).toMatchObject({
      resolved: true,
      toolId: "github.repositories.list",
      confidence: "high",
    });
  });

  it("runs through policy and the explicit read-only handler without approval", async () => {
    clearExecutionAuditRecords();
    const sourceStep = step();
    const resolution = resolveToolForStep({ step: sourceStep });
    const result = await runReadOnlyTool({
      requestId: "request:github-list",
      step: sourceStep,
      toolResolution: resolution,
      approval: null,
      executionInput: {},
      executionContext: {
        githubRepositoriesClient: {
          async listRepositories() {
            return {
              connectionStatus: "connected" as const,
              repositories: [
                { id: "1", name: "smartflow", owner: "aryan", visibility: "private" as const, defaultBranch: "main", archived: false },
              ],
            };
          },
        },
      },
      currentTime: new Date("2026-07-22T10:00:00Z"),
    });
    expect(result).toMatchObject({ success: true, toolId: "github.repositories.list" });
    expect(result.safeSummary).toBe("1 connected GitHub repository found.");
    expect(result.safePreviewItems).toEqual(["aryan/smartflow"]);
    const audit = getExecutionAuditRecordsByRequestId("request:github-list");
    expect(audit.map((record) => record.status)).toEqual(["started", "success"]);
    expect(JSON.stringify(audit)).not.toMatch(/token|authorization/i);
  });

  it("returns a safe not-connected result instead of synthesizing provider data", async () => {
    const sourceStep = step();
    const result = await runReadOnlyTool({
      requestId: "request:github-not-connected",
      step: sourceStep,
      toolResolution: resolveToolForStep({ step: sourceStep }),
      executionInput: {},
      executionContext: {},
    });
    expect(result.success).toBe(true);
    expect(result.safeSummary).toBe("No GitHub connection is available.");
    expect(result.safePreviewItems).toEqual([]);
  });

  it("synthesizes only bounded GitHub evidence and composes en/de/fa responses", () => {
    const synthesized = synthesizeContext({
      toolId: "github.repositories.list",
      executionStatus: "success",
      safeRuntimeSummary: "2 connected GitHub repositories found.",
      safePreviewItems: ["owner/one", "owner/two"],
      responseLanguage: "en",
      generatedAt: "2026-07-22T10:00:00.000Z",
    });
    expect(synthesized.evidenceDomains).toEqual(["github"]);
    expect(synthesized.primaryFact).toBe("2 connected GitHub repositories found.");

    const english = composeAssistantResponse({
      toolId: "github.repositories.list",
      language: "en",
      success: true,
      safeSummary: "2 connected GitHub repositories found.",
      safePreviewItems: ["owner/one", "owner/two"],
      synthesizedContext: synthesized,
    });
    const german = composeAssistantResponse({ ...englishInput("de"), synthesizedContext: undefined });
    const persian = composeAssistantResponse({ ...englishInput("fa"), synthesizedContext: undefined });
    expect(english.headline).toContain("GitHub repositories");
    expect(german.headline).toContain("GitHub-Repositories");
    expect(persian.headline).toContain("گیت‌هاب");
  });
});

function englishInput(language: "de" | "fa") {
  return {
    toolId: "github.repositories.list",
    language,
    success: true,
    safeSummary: "2 connected GitHub repositories found.",
    safePreviewItems: ["owner/one", "owner/two"],
  } as const;
}
