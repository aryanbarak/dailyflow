import { describe, expect, it } from "vitest";
import {
  canComposeAssistantResponse,
  composeAssistantResponse,
  formatAssistantResponse,
  type ResponseComposerInput,
} from "./responseComposer";
import { GITHUB_NOT_CONNECTED_SUMMARY } from "./readOnlyResultPresenter";

function input(overrides: Partial<ResponseComposerInput>): ResponseComposerInput {
  return {
    toolId: "tasks.list",
    language: "en",
    success: true,
    safeSummary: "2 active tasks found.",
    safePreviewItems: ["Finish report", "Review calendar"],
    ...overrides,
  };
}

describe("responseComposer", () => {
  it("composes a natural tasks.list response from safe preview data", () => {
    const response = composeAssistantResponse(input({}));

    expect(response.headline).toBe("Here is your task overview.");
    expect(response.summary).toBe("You currently have 2 active tasks.");
    expect(response.details).toEqual(["Finish report", "Review calendar"]);
    expect(formatAssistantResponse(response)).toContain("- Finish report");
  });

  it("composes calendar, learning, workspace, and tasks.complete responses", () => {
    expect(composeAssistantResponse(input({
      toolId: "calendar.list_today",
      safeSummary: "No events today.",
      safePreviewItems: [],
    })).summary).toBe("Your calendar is clear today.");

    expect(composeAssistantResponse(input({
      toolId: "learning.get_progress",
      safeSummary: "3 learning items found.",
      safePreviewItems: ["Sorting Algorithms"],
    })).summary).toBe("I found 3 learning items.");

    expect(composeAssistantResponse(input({
      toolId: "workspace.get_context",
      safeSummary: "Workspace context loaded.",
      safePreviewItems: [],
    })).headline).toBe("Here is the workspace context I verified.");

    expect(composeAssistantResponse(input({
      toolId: "tasks.complete",
      safeSummary: "Task was marked complete.",
      safePreviewItems: [],
    })).summary).toBe("The task is marked complete.");

    expect(composeAssistantResponse(input({
      toolId: "tasks.complete",
      safeSummary: "Task was already complete.",
      safePreviewItems: [],
    })).summary).toBe("The task was already complete, so I did not change it again.");
  });

  it("keeps unsupported tools on the safe fallback path", () => {
    expect(canComposeAssistantResponse("documents.search")).toBe(false);
    const response = composeAssistantResponse(input({
      toolId: "documents.search",
      safeSummary: "The read-only action completed.",
      safePreviewItems: ["Hidden item"],
    }));

    expect(response.headline).toBe("The action completed safely.");
    expect(response.summary).toBe("The read-only action completed.");
    expect(response.details).toEqual([]);
  });

  it("handles empty natural results without inventing facts", () => {
    const response = composeAssistantResponse(input({
      safeSummary: "No active tasks found.",
      safePreviewItems: [],
    }));

    expect(response.summary).toBe("You do not have active tasks right now.");
    expect(response.details).toEqual([]);
    expect(response.optionalSuggestion).toBeUndefined();
    expect(formatAssistantResponse(response)).not.toContain("- ");
  });

  it("switches deterministic copy by language", () => {
    const german = composeAssistantResponse(input({ language: "de" }));
    const farsi = composeAssistantResponse(input({ language: "fa" }));

    expect(german.headline).toBe("Hier ist deine Aufgabenubersicht.");
    expect(german.summary).toContain("aktive Aufgaben");
    expect(farsi.headline).toContain("\u06a9\u0627\u0631\u0647\u0627");
    expect(farsi.summary).toContain("2");
  });

  // Task 33 production evidence: "GitHub is not connected." (raw English)
  // rendered verbatim inside Farsi/German replies, because this composer's
  // ONLY detection for an empty/not-connected summary was a /^no\s+/i
  // prefix match, and readOnlyResultPresenter.ts's not-connected literal
  // didn't start with "No " -- responseComposer.test.ts had ZERO coverage
  // of this path before task 33-fix (confirmed by task 33's own diagnosis).
  // Covers all four GitHub tool ids this composer actually supports
  // (github.epics.list is NOT in SUPPORTED_RESPONSE_COMPOSER_TOOL_IDS at
  // all today -- a separate, pre-existing gap noted in the task 33-fix
  // report, not fixed here).
  describe("GitHub not-connected summary renders translated, never raw English outside en (task 33-fix)", () => {
    it.each([
      ["github.repositories.list", "GitHub ist nicht verbunden oder es sind keine Repositories verfuegbar.", "گیت‌هاب متصل نیست یا مخزنی در دسترس نیست."],
      ["github.issues.list", "GitHub ist nicht verbunden oder es sind keine offenen Issues verfuegbar.", "گیت‌هاب متصل نیست یا ایشوی بازی در دسترس نیست."],
      ["github.pulls.list", "GitHub ist nicht verbunden oder es sind keine offenen Pull-Requests verfuegbar.", "گیت‌هاب متصل نیست یا پول‌ریکوئست بازی در دسترس نیست."],
      ["github.workflow_runs.list", "GitHub ist nicht verbunden oder es sind keine letzten Workflow-Laeufe verfuegbar.", "گیت‌هاب متصل نیست یا اجرای اخیری در دسترس نیست."],
    ] as const)("%s", (toolId, expectedDe, expectedFa) => {
      const german = composeAssistantResponse(input({
        toolId,
        language: "de",
        safeSummary: GITHUB_NOT_CONNECTED_SUMMARY,
        safePreviewItems: [],
      }));
      const farsi = composeAssistantResponse(input({
        toolId,
        language: "fa",
        safeSummary: GITHUB_NOT_CONNECTED_SUMMARY,
        safePreviewItems: [],
      }));

      expect(german.summary).toBe(expectedDe);
      expect(farsi.summary).toBe(expectedFa);

      // The exact task 33 regression: the raw English literal must never
      // survive into a non-English reply, in any form.
      expect(german.summary).not.toContain(GITHUB_NOT_CONNECTED_SUMMARY);
      expect(farsi.summary).not.toContain(GITHUB_NOT_CONNECTED_SUMMARY);
      expect(german.summary).not.toContain("GitHub is not connected");
      expect(farsi.summary).not.toContain("GitHub is not connected");
    });

    it("also normalizes to the composed English copy in en (not the raw safeSummary passed through verbatim)", () => {
      const response = composeAssistantResponse(input({
        toolId: "github.repositories.list",
        language: "en",
        safeSummary: GITHUB_NOT_CONNECTED_SUMMARY,
        safePreviewItems: [],
      }));
      expect(response.summary).toBe("GitHub is not connected or no repositories are available.");
      expect(response.summary).not.toBe(GITHUB_NOT_CONNECTED_SUMMARY);
    });
  });

  it("does not invent absent preview titles or mutate runtime results", () => {
    const runtimeItems = ["Only verified title"];
    const runtimeInput = input({
      safePreviewItems: runtimeItems,
      safeSummary: "1 active task found.",
    });

    const response = composeAssistantResponse(runtimeInput);

    expect(response.details).toEqual(["Only verified title"]);
    expect(formatAssistantResponse(response)).not.toContain("Another title");
    expect(runtimeItems).toEqual(["Only verified title"]);
    expect(runtimeInput.safeSummary).toBe("1 active task found.");
  });

  it("scrubs internal fields and uses reflection only for optional wording", () => {
    const response = composeAssistantResponse(input({
      safeSummary: "requestId: req-123 1 active task found.",
      safePreviewItems: ["stepId: step-1 Finish report", "Keep this title"],
      reflection: {
        id: "reflection-1",
        requestId: "req-123",
        stepId: "step-1",
        goalId: "goal-1",
        toolId: "tasks.list",
        outcome: "successful",
        usefulness: "medium",
        goalProgress: "informed",
        stepAssessment: "information_gathered",
        confidence: "high",
        summary: "Safe reflection summary",
        evidence: [],
        suggestedFollowUp: "Start with the first active task.",
        retainAsMemoryEvidence: true,
        generatedAt: "2026-07-15T10:00:00.000Z",
        reflectionVersion: "reflection-engine-v1",
      },
    }));

    expect(response.summary).toBe("You currently have 1 active task.");
    expect(response.details).toEqual(["Finish report", "Keep this title"]);
    expect(response.optionalSuggestion).toBe("Start with the first active task.");
    expect(formatAssistantResponse(response)).not.toContain("req-123");
    expect(formatAssistantResponse(response)).not.toContain("step-1");
  });

  it("does not expose task ids, schema versions, scores, or engine names", () => {
    const response = composeAssistantResponse(input({
      safeSummary: "taskId: task-1 schemaVersion: 1 score: 99 1 active task found.",
      safePreviewItems: ["Reflection Engine taskId: task-2 Visible task"],
      reflection: {
        id: "reflection-1",
        requestId: "req-123",
        stepId: "step-1",
        goalId: "goal-1",
        toolId: "tasks.list",
        outcome: "successful",
        usefulness: "medium",
        goalProgress: "informed",
        stepAssessment: "information_gathered",
        confidence: "high",
        summary: "Safe reflection summary",
        evidence: [],
        suggestedFollowUp: "Decision Intelligence suggests nothing internal.",
        retainAsMemoryEvidence: true,
        generatedAt: "2026-07-15T10:00:00.000Z",
        reflectionVersion: "reflection-engine-v1",
      },
    }));
    const rendered = formatAssistantResponse(response);

    expect(rendered).not.toContain("task-1");
    expect(rendered).not.toContain("task-2");
    expect(rendered).not.toContain("schemaVersion");
    expect(rendered).not.toContain("score");
    expect(rendered).not.toContain("Reflection Engine");
    expect(rendered).not.toContain("Decision Intelligence");
  });

  it("uses synthesized context when present and still works without it", () => {
    const withoutSynthesis = composeAssistantResponse(input({
      safeSummary: "6 active tasks found.",
      safePreviewItems: [],
    }));
    const withSynthesis = composeAssistantResponse(input({
      safeSummary: "6 active tasks found.",
      safePreviewItems: ["Visible task"],
      synthesizedContext: {
        primaryFact: "1 of your 6 open tasks is due today.",
        supportingFacts: ["3 open tasks do not have due dates."],
        safeSuggestion: "You may want to add due dates to those tasks.",
        evidenceDomains: ["tasks"],
        confidence: "medium",
        synthesisVersion: "context-synthesis-v1",
      },
    }));

    expect(withoutSynthesis.summary).toBe("You currently have 6 active tasks.");
    expect(withSynthesis.summary).toBe("1 of your 6 open tasks is due today.");
    expect(withSynthesis.details).toEqual(["3 open tasks do not have due dates.", "Visible task"]);
    expect(withSynthesis.optionalSuggestion).toBe("You may want to add due dates to those tasks.");
  });

  it("does not backfill a suggestion when synthesis was suppressed by contradiction", () => {
    const response = composeAssistantResponse(input({
      safeSummary: "0 active tasks found.",
      safePreviewItems: [],
      synthesizedContext: {
        supportingFacts: [],
        evidenceDomains: [],
        confidence: "low",
        synthesisVersion: "context-synthesis-v1",
      },
    }));

    expect(response.summary).toBe("You do not have active tasks right now.");
    expect(response.optionalSuggestion).toBeUndefined();
  });
});
