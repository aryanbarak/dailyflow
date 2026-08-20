import { describe, expect, it } from "vitest";
import { buildReasoningPrompt } from "./reasoningPrompt";
import type { AgentReasoningPromptInput, AgentReasoningSafeContext } from "./reasoningTypes";
import { writeIntentRegistry } from "../../../../shared/writeIntentRegistry";

const now = new Date("2026-07-25T09:00:00.000Z");

function baseSafeContext(overrides: Partial<AgentReasoningSafeContext> = {}): AgentReasoningSafeContext {
  return {
    tasks: [],
    events: [],
    learningProgress: null,
    workspace: null,
    ...overrides,
  };
}

function promptInput(overrides: Partial<AgentReasoningPromptInput> = {}): AgentReasoningPromptInput {
  return {
    userMessage: "چه چیزی در Smart Academy باز مانده؟",
    configuredResponseLanguage: "auto",
    interfaceLanguage: "fa",
    safeContext: baseSafeContext(),
    responseLanguage: "fa",
    now,
    ...overrides,
  };
}

function githubInventoryFromPrompt(prompt: string) {
  const match = prompt.match(/Current safe context JSON: (.+)\nUser message:/s);
  expect(match).not.toBeNull();
  const parsed = JSON.parse(match![1]) as { githubRepositoryInventory: unknown };
  return parsed.githubRepositoryInventory;
}

describe("buildReasoningPrompt githubRepositoryInventory", () => {
  it("renders unknown when the field is entirely absent from safeContext", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(githubInventoryFromPrompt(prompt)).toEqual({ status: "unknown" });
  });

  it("renders unknown when explicitly marked unknown, distinct from a known-empty list", () => {
    const prompt = buildReasoningPrompt(promptInput({
      safeContext: baseSafeContext({ githubRepositoryInventory: { status: "unknown" } }),
    }));
    expect(githubInventoryFromPrompt(prompt)).toEqual({ status: "unknown" });
  });

  it("renders known with an empty list as a genuinely different shape than unknown", () => {
    const prompt = buildReasoningPrompt(promptInput({
      safeContext: baseSafeContext({ githubRepositoryInventory: { status: "known", names: [] } }),
    }));
    expect(githubInventoryFromPrompt(prompt)).toEqual({ status: "known", names: [] });
  });

  it("renders known repository names, capped and sanitized", () => {
    const names = Array.from({ length: 20 }, (_, i) => `owner/repo-${i}`);
    const prompt = buildReasoningPrompt(promptInput({
      safeContext: baseSafeContext({ githubRepositoryInventory: { status: "known", names } }),
    }));
    const rendered = githubInventoryFromPrompt(prompt) as { status: string; names: string[] };
    expect(rendered.status).toBe("known");
    expect(rendered.names).toHaveLength(12);
    expect(rendered.names[0]).toBe("owner/repo-0");
  });

  it("includes an explicit instruction that unknown must not be read as zero repositories", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(prompt).toContain("does NOT mean the user has no GitHub repositories");
  });

  it("includes an instruction that a name match is disambiguation evidence, not a tool selector", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(prompt).toContain("never by itself selects which GitHub tool");
  });
});

describe("buildReasoningPrompt finance support", () => {
  it("lists create_finance_transaction as supported and drops the old finance-unsupported phrasing", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(prompt).toContain("create_finance_transaction");
    expect(prompt).not.toContain("finance mutations");
  });

  it.each(writeIntentRegistry.map((entry) => entry.intentType))(
    "includes registry write intent %s in the built prompt",
    (intentType) => {
      const prompt = buildReasoningPrompt(promptInput());
      expect(prompt).toContain(intentType);
    },
  );

  // ADR-0013 Slice 5, task 36f: "Allowed mappings" is now generated (the
  // registry-covered pairs; complete_task/github.* stay hand-written around
  // them) -- this loops every registry entry's own toolId, generalising the
  // intentType-only loop above so a future registry entry with a wrong or
  // missing toolId in the mapping fails here too.
  it.each(writeIntentRegistry.map((entry) => [entry.intentType, entry.toolId] as const))(
    "includes the registry mapping %s->%s in the built prompt",
    (intentType, toolId) => {
      const prompt = buildReasoningPrompt(promptInput());
      expect(prompt).toContain(`${intentType}->${toolId}`);
    },
  );

  // ADR-0013 Slice 5, task 36f: task 29 broke production because the old
  // "Unsupported requests" line still named "finance mutations" as
  // unsupported after finance shipped -- caught here only for finance
  // (line 83 above, kept). This generalises the same shape of check to
  // EVERY registry domain, not just finance, so the next domain added to the
  // registry cannot repeat task 29's exact mistake unnoticed.
  it.each([...new Set(writeIntentRegistry.map((entry) => entry.domain))])(
    "never calls %s mutations unsupported",
    (domain) => {
      const prompt = buildReasoningPrompt(promptInput());
      expect(prompt).not.toContain(`${domain} mutations`);
    },
  );

  // ADR-0013 Slice 5, task 36f Part B proof: the "Supported intents" and
  // "Allowed mappings" lines must be byte-identical to their pre-refactor,
  // fully hand-written literals for the CURRENT registry contents -- these
  // two constants are exactly what the two lines said immediately before
  // this slice's edit (see the task's own diff / git history for
  // confirmation), not re-derived from the generation code under test.
  it("renders the Supported intents line byte-identical to the pre-refactor literal", () => {
    const prompt = buildReasoningPrompt(promptInput());
    const line = prompt.split("\n").find((entry) => entry.startsWith("Supported intents:"));
    expect(line).toBe(
      "Supported intents: inspect_tasks, inspect_calendar, inspect_learning, inspect_workspace, inspect_github_repositories, inspect_github_issues, inspect_github_epics, inspect_github_pull_requests, inspect_github_workflow_runs, complete_task, create_task, update_task, create_calendar_event, update_calendar_event, create_finance_transaction, write_github_issue_comment, write_github_issue_update, ask_clarification, unsupported.",
    );
  });

  it("renders the Allowed mappings line byte-identical to the pre-refactor literal", () => {
    const prompt = buildReasoningPrompt(promptInput());
    const line = prompt.split("\n").find((entry) => entry.startsWith("Allowed mappings:"));
    expect(line).toBe(
      "Allowed mappings: inspect_tasks->tasks.list, inspect_calendar->calendar.list_today, inspect_learning->learning.get_progress, inspect_workspace->workspace.get_context, inspect_github_repositories->github.repositories.list, inspect_github_issues->github.issues.list, inspect_github_epics->github.epics.list, inspect_github_pull_requests->github.pulls.list, inspect_github_workflow_runs->github.workflow_runs.list, complete_task->tasks.complete, create_task->tasks.create, update_task->tasks.update, create_calendar_event->calendar.create_event, update_calendar_event->calendar.update_event, create_finance_transaction->finance.create_transaction, write_github_issue_comment->github.issues.comment, write_github_issue_update->github.issues.update.",
    );
  });

  // ADR-0013 Slice 5: the registry's promptInstruction is now consumed --
  // create_task/update_task carry none (Slice 0's explicit PO decision) and
  // must contribute nothing observable: no literal "undefined" and no
  // doubled/stray whitespace from an empty array element.
  it("never renders a dangling 'undefined' or a doubled newline from entries with no promptInstruction", () => {
    const prompt = buildReasoningPrompt(promptInput());
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("\n\n");
  });
});
