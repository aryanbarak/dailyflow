import { describe, expect, it } from "vitest";
import { resolveDisambiguationCandidates, validateAgentIntentProposal } from "./intentValidator";
import type { AgentReasoningSafeContext } from "./reasoningTypes";
import type { SupportedAiResponseLanguage } from "@/features/ai/responseLanguage";

const now = new Date("2026-07-15T08:00:00.000Z");

const context: AgentReasoningSafeContext = {
  tasks: [
    { id: "task-1", title: "Tax report", completed: false, status: "open" },
    { id: "task-2", title: "Tax report archive", completed: false, status: "open" },
    { id: "task-3", title: "Clean desk", completed: true, status: "completed" },
  ],
  events: [{ id: "event-1", title: "Standup", dateTimeStart: now.toISOString() }],
  learningProgress: {
    lessons: [{ id: "lesson-1", title: "Sorting", completionPercentage: 82 }],
  },
};

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    type: "inspect_tasks",
    confidence: "high",
    userMessage: "What tasks do I have?",
    requestedDomain: "tasks",
    toolId: "tasks.list",
    requiresTool: true,
    requiresApproval: false,
    reasons: ["Task inspection requested."],
    language: "en",
    generatedAt: now.toISOString(),
    schemaVersion: 1,
    ...overrides,
  };
}

function validate(rawProposal: unknown, userMessage = "What tasks do I have?") {
  return validateAgentIntentProposal({
    rawProposal,
    userMessage,
    safeContext: context,
    language: "en",
    now,
  });
}

function validateWithContext(
  rawProposal: unknown,
  userMessage: string,
  safeContext: AgentReasoningSafeContext,
  language: SupportedAiResponseLanguage = "en",
) {
  return validateAgentIntentProposal({
    rawProposal,
    userMessage,
    safeContext,
    language,
    now,
  });
}

describe("intentValidator", () => {
  it("validates inspect intent mappings", () => {
    expect(validate(proposal({ type: "inspect_tasks", toolId: "tasks.list" })).toolId).toBe("tasks.list");
    expect(validate(proposal({ type: "inspect_calendar", requestedDomain: "calendar", toolId: "calendar.list_today" }), "What is on my calendar today?").toolId).toBe("calendar.list_today");
    expect(validate(proposal({ type: "inspect_learning", requestedDomain: "learning", toolId: "learning.get_progress" }), "Show my learning progress.").toolId).toBe("learning.get_progress");
    expect(validate(proposal({ type: "inspect_workspace", requestedDomain: "workspace", toolId: "workspace.get_context" }), "Summarize my workspace.").toolId).toBe("workspace.get_context");
  });

  it("rejects unknown intent and invented tool id", () => {
    expect(validate(proposal({ type: "inspect_secret" }), "Hello there").proposal.type).toBe("unsupported");
    expect(validate(proposal({ toolId: "finance.pay" })).proposal.type).toBe("unsupported");
  });

  it("rescues an unrecognized intent type using deterministic domain evidence, like a parse failure", () => {
    const rescued = validate(
      proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
      "Show my connected GitHub repositories",
    );

    expect(rescued.proposal.type).toBe("inspect_github_repositories");
    expect(rescued.toolId).toBe("github.repositories.list");
    expect(rescued.proposal.requestedDomain).toBe("github");
  });

  it("still rejects an unrecognized intent type when there is no domain evidence to rescue it", () => {
    expect(validate(proposal({ type: "whatever" }), "Hello there").proposal.type).toBe("unsupported");
  });

  it("resolves the production payload: unrecognized type, invented domain literal, correct tool id", () => {
    const result = validate(
      proposal({
        type: "intent",
        requestedDomain: "github_repositories",
        toolId: "github.repositories.list",
      }),
      "Show my connected GitHub repositories",
    );

    expect(result.proposal.type).toBe("inspect_github_repositories");
    expect(result.toolId).toBe("github.repositories.list");
    expect(result.proposal.requestedDomain).toBe("github");
  });

  it("treats a numeric confidence as usable, not low, so evidence rescue still lands", () => {
    const result = validate(
      proposal({ type: "intent", confidence: 0.9 }),
      "Show my connected GitHub repositories",
    );

    expect(result.proposal.type).toBe("inspect_github_repositories");
  });

  it("still asks clarification for an explicit low confidence", () => {
    expect(validate(proposal({ confidence: "low" })).proposal.type).toBe("ask_clarification");
  });

  it("still asks clarification when confidence is missing or garbage and there is no domain evidence to resolve the type", () => {
    const missing = validate(proposal({ type: "ask_clarification", confidence: undefined }), "Hello there");
    const garbage = validate(proposal({ type: "ask_clarification", confidence: 0.9 }), "Hello there");

    expect(missing.proposal.type).toBe("ask_clarification");
    expect(garbage.proposal.type).toBe("ask_clarification");
  });

  it("resolves the full live production payload: unrecognized type, string target, invented domain, numeric confidence", () => {
    const result = validate(
      proposal({
        type: "intent",
        target: "github.repositories.list",
        requestedDomain: "github_repositories",
        toolId: "github.repositories.list",
        confidence: 0.9,
      }),
      "Show my connected GitHub repositories",
    );

    expect(result.proposal.type).toBe("inspect_github_repositories");
    expect(result.toolId).toBe("github.repositories.list");
    expect(result.proposal.requestedDomain).toBe("github");
  });

  it("validates the github issues intent mapping", () => {
    const result = validate(
      proposal({ type: "inspect_github_issues", requestedDomain: "github", toolId: "github.issues.list" }),
      "Show my open GitHub issues.",
    );
    expect(result.proposal.type).toBe("inspect_github_issues");
    expect(result.toolId).toBe("github.issues.list");
  });

  it("rescues an unrecognized type into the github intent the evidence actually names, not always repositories", () => {
    const repositories = validate(
      proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
      "Show my connected GitHub repositories",
    );
    const issues = validate(
      proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
      "Show my open GitHub issues",
    );

    expect(repositories.proposal.type).toBe("inspect_github_repositories");
    expect(repositories.toolId).toBe("github.repositories.list");
    expect(issues.proposal.type).toBe("inspect_github_issues");
    expect(issues.toolId).toBe("github.issues.list");
  });

  it("does not guess between repositories and issues when a message names both: leaves it unrescued", () => {
    const result = validate(
      proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
      "Show my GitHub repositories and my open GitHub issues",
    );

    // Unrescued from an unrecognized type with domain evidence present but
    // no clean single-intent match falls through the same path as no
    // evidence at all: unsupported, not a guessed pick between the two.
    expect(result.proposal.type).toBe("unsupported");
  });

  it("does not override an already-valid, explicit type when repo/issue evidence conflicts in the same message", () => {
    const result = validate(
      proposal({ type: "inspect_github_issues", requestedDomain: "github", toolId: "github.issues.list" }),
      "Show my GitHub repositories and my open GitHub issues",
    );

    expect(result.proposal.type).toBe("inspect_github_issues");
    expect(result.toolId).toBe("github.issues.list");
  });

  it("resolves the production-shaped issues payload: unrecognized type, invented domain literal, correct tool id", () => {
    const result = validate(
      proposal({
        type: "intent",
        requestedDomain: "github_issues",
        toolId: "github.issues.list",
      }),
      "Show my open GitHub issues",
    );

    expect(result.proposal.type).toBe("inspect_github_issues");
    expect(result.toolId).toBe("github.issues.list");
    expect(result.proposal.requestedDomain).toBe("github");
  });

  it("validates the github epics intent mapping", () => {
    const result = validate(
      proposal({ type: "inspect_github_epics", requestedDomain: "github", toolId: "github.epics.list" }),
      "Show me the roadmap epics.",
    );
    expect(result.proposal.type).toBe("inspect_github_epics");
    expect(result.toolId).toBe("github.epics.list");
  });

  it("rescues an unrecognized type into inspect_github_epics from roadmap/epic evidence, English and Persian", () => {
    const english = validate(
      proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
      "What's on the roadmap?",
    );
    const persian = validate(
      proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
      "نقشه راه پروژه چیست؟",
    );

    expect(english.proposal.type).toBe("inspect_github_epics");
    expect(english.toolId).toBe("github.epics.list");
    expect(persian.proposal.type).toBe("inspect_github_epics");
    expect(persian.toolId).toBe("github.epics.list");
  });

  it("does not let bare 'plan' evidence collide with the workspace domain's 'current plan' evidence", () => {
    const result = validate(
      proposal({ type: "intent", requestedDomain: "workspace", toolId: "workspace.get_context" }),
      "What's my current plan?",
    );

    // Only "project plan" counts as epics evidence (see the exclusion note
    // next to GITHUB_EPICS_EVIDENCE_PATTERNS) -- a bare "plan" inside
    // "current plan" must not turn this into a conflicting-domain
    // clarification instead of resolving to the workspace intent.
    expect(result.proposal.type).toBe("inspect_workspace");
    expect(result.toolId).toBe("workspace.get_context");
  });

  describe("EPIC-07 (Write Light) write intents", () => {
    it("resolves write_github_issue_comment only with a fully-formed target, otherwise asks for clarification", () => {
      const incomplete = validate(
        proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
        "add a comment saying LGTM to the issue",
      );
      expect(incomplete.proposal.type).toBe("ask_clarification");

      const complete = validate(
        proposal({
          type: "write_github_issue_comment",
          requestedDomain: "github",
          toolId: "github.issues.comment",
          target: { repo: "aryan/smartflow", issueNumber: 5, commentBody: "Thanks!" },
        }),
        "add a comment to the issue",
      );
      expect(complete.proposal.type).toBe("write_github_issue_comment");
      expect(complete.toolId).toBe("github.issues.comment");
      expect(complete.proposal.requiresApproval).toBe(true);
      expect(complete.proposal.target).toMatchObject({ repo: "aryan/smartflow", issueNumber: 5, commentBody: "Thanks!" });
    });

    it("resolves write_github_issue_update only with repo+issueNumber and at least one of title/body/labels", () => {
      const missingChange = validate(
        proposal({
          type: "write_github_issue_update",
          requestedDomain: "github",
          toolId: "github.issues.update",
          target: { repo: "aryan/smartflow", issueNumber: 5 },
        }),
        "update this issue",
      );
      expect(missingChange.proposal.type).toBe("ask_clarification");

      const withLabels = validate(
        proposal({
          type: "write_github_issue_update",
          requestedDomain: "github",
          toolId: "github.issues.update",
          target: { repo: "aryan/smartflow", issueNumber: 5, updateLabels: ["bug"] },
        }),
        "update this issue",
      );
      expect(withLabels.proposal.type).toBe("write_github_issue_update");
      expect(withLabels.proposal.requiresApproval).toBe(true);
    });

    it("does not let bare create/update/add words block an already-confirmed write intent", () => {
      // "add" and "update" are in requestLooksUnsupported's blocklist -- must
      // not fire once type has resolved to a confirmed write intent.
      const comment = validate(
        proposal({
          type: "write_github_issue_comment",
          requestedDomain: "github",
          toolId: "github.issues.comment",
          target: { repo: "aryan/smartflow", issueNumber: 5, commentBody: "add this note" },
        }),
        "add a comment to the issue",
      );
      const update = validate(
        proposal({
          type: "write_github_issue_update",
          requestedDomain: "github",
          toolId: "github.issues.update",
          target: { repo: "aryan/smartflow", issueNumber: 5, updateLabels: ["bug"] },
        }),
        "update this issue's labels",
      );
      expect(comment.proposal.type).not.toBe("unsupported");
      expect(update.proposal.type).not.toBe("unsupported");
    });

    it("still rejects unrelated create/delete requests as unsupported", () => {
      expect(validate(proposal(), "delete my account please").proposal.type).toBe("unsupported");
    });

    it("asks for clarification instead of guessing when a message mixes a read verb with a write verb", () => {
      const result = validate(
        proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
        "show my issues and add a comment saying done",
      );
      expect(["ask_clarification", "unsupported"]).toContain(result.proposal.type);
    });

    it("does not let a message naming both comment and update evidence guess between them", () => {
      const result = validate(
        proposal({ type: "intent", requestedDomain: "tasks", toolId: "tasks.list" }),
        "update this issue and add a comment",
      );
      expect(result.proposal.type).not.toBe("write_github_issue_comment");
      expect(result.proposal.type).not.toBe("write_github_issue_update");
    });

    it("drops an out-of-range or malformed repo/issueNumber/labels instead of trusting them", () => {
      const result = validate(
        proposal({
          type: "write_github_issue_update",
          requestedDomain: "github",
          toolId: "github.issues.update",
          target: { repo: "not-a-valid-repo-format", issueNumber: -5, updateLabels: "not-an-array" },
        }),
        "update this issue",
      );
      expect(result.proposal.type).toBe("ask_clarification");
    });
  });

  it("handles malformed or non-object output safely", () => {
    const result = validate(null);

    expect(result.proposal.type).toBe("ask_clarification");
    expect(result.proposal.requiresTool).toBe(false);
  });

  it("rejects unsupported create, update, and delete requests", () => {
    expect(validate(proposal({ type: "inspect_tasks" }), "Create a task").proposal.type).toBe("unsupported");
    expect(validate(proposal({ type: "inspect_tasks" }), "Update the task").proposal.type).toBe("unsupported");
    expect(validate(proposal({ type: "inspect_tasks" }), "Delete this task").proposal.type).toBe("unsupported");
    expect(validate(proposal({ type: "inspect_calendar", requestedDomain: "calendar", toolId: "calendar.list_today" }), "Verschiebe meinen Termin auf 15 Uhr.").proposal.type).toBe("unsupported");
    expect(validate(proposal({ type: "inspect_tasks" }), "برای فردا یک وظیفه بساز.").proposal.type).toBe("unsupported");
  });

  it("rejects mixed read and completion requests instead of partially executing", () => {
    expect(validate(proposal({ type: "inspect_tasks" }), "Check my tasks and complete the most important one.").proposal.type).toBe("ask_clarification");
    expect(validate(proposal({ type: "inspect_calendar", requestedDomain: "calendar", toolId: "calendar.list_today" }), "Show my calendar and create a focus block.").proposal.type).toBe("unsupported");
    expect(validate(proposal({ type: "inspect_learning", requestedDomain: "learning", toolId: "learning.get_progress" }), "Continue learning and finish the related task.").proposal.type).toBe("ask_clarification");
  });

  it("asks clarification for low confidence", () => {
    const result = validate(proposal({ confidence: "low" }));

    expect(result.proposal.type).toBe("ask_clarification");
    expect(result.proposal.clarificationQuestion).toBeTruthy();
  });

  it("rejects userId and extra action fields", () => {
    expect(validate(proposal({ userId: "user-1" })).proposal.type).toBe("unsupported");
    expect(validate(proposal({ actions: [{ type: "inspect_tasks" }] })).proposal.type).toBe("unsupported");
    expect(validate(proposal({ extraActions: ["tasks.list"] })).proposal.type).toBe("unsupported");
  });

  it("requires exact task target for complete_task", () => {
    const missing = validate(proposal({
      type: "complete_task",
      requestedDomain: "tasks",
      toolId: "tasks.complete",
      target: {},
    }), "Complete this task");
    const ambiguous = validate(proposal({
      type: "complete_task",
      requestedDomain: "tasks",
      toolId: "tasks.complete",
      target: { taskTitleHint: "Tax report" },
    }), "Complete the tax report task");
    const exact = validate(proposal({
      type: "complete_task",
      requestedDomain: "tasks",
      toolId: "tasks.complete",
      target: { taskId: "task-1" },
    }), "Complete the tax report task");

    expect(missing.proposal.type).toBe("ask_clarification");
    expect(ambiguous.proposal.type).toBe("ask_clarification");
    expect(exact.proposal.type).toBe("complete_task");
    expect(exact.proposal.target?.taskId).toBe("task-1");
    expect(exact.proposal.requiresApproval).toBe(true);
  });

  it("normalizes selected-task completion only when it can bind one exact task", () => {
    const selectedContext: AgentReasoningSafeContext = {
      ...context,
      tasks: [{ id: "task-selected", title: "Selected task", completed: false, status: "open" }],
    };
    const result = validateWithContext(
      proposal({ type: "inspect_tasks", toolId: "tasks.list" }),
      "Mark the selected task done.",
      selectedContext,
    );

    expect(result.proposal.type).toBe("complete_task");
    expect(result.proposal.toolId).toBe("tasks.complete");
    expect(result.proposal.target?.taskId).toBe("task-selected");
    expect(result.proposal.requiresApproval).toBe(true);
  });

  it("normalizes German selected-task completion only with one exact selected task", () => {
    const selectedContext: AgentReasoningSafeContext = {
      ...context,
      tasks: [{ id: "task-selected-de", title: "Ausgewählte Aufgabe", completed: false, status: "open" }],
    };

    const markiere = validateWithContext(
      proposal({ type: "inspect_tasks", toolId: "tasks.list" }),
      "Markiere die ausgewählte Aufgabe als erledigt.",
      selectedContext,
      "de",
    );
    const erledige = validateWithContext(
      proposal({ type: "inspect_tasks", toolId: "tasks.list" }),
      "Erledige die ausgewählte Aufgabe.",
      selectedContext,
      "de",
    );

    expect(markiere.proposal.type).toBe("complete_task");
    expect(markiere.proposal.target?.taskId).toBe("task-selected-de");
    expect(markiere.proposal.requiresApproval).toBe(true);
    expect(erledige.proposal.type).toBe("complete_task");
    expect(erledige.proposal.target?.taskId).toBe("task-selected-de");
  });

  it("normalizes Persian selected-task completion only with one exact selected task", () => {
    const selectedContext: AgentReasoningSafeContext = {
      ...context,
      tasks: [{ id: "task-selected-fa", title: "کار انتخاب‌شده", completed: false, status: "open" }],
    };

    const completeSelected = validateWithContext(
      proposal({ type: "inspect_tasks", toolId: "tasks.list" }),
      "وظیفه انتخاب‌شده را تکمیل کن.",
      selectedContext,
      "fa",
    );
    const markDone = validateWithContext(
      proposal({ type: "inspect_tasks", toolId: "tasks.list" }),
      "کار انتخاب‌شده را انجام‌شده علامت بزن.",
      selectedContext,
      "fa",
    );

    expect(completeSelected.proposal.type).toBe("complete_task");
    expect(completeSelected.proposal.target?.taskId).toBe("task-selected-fa");
    expect(completeSelected.proposal.requiresApproval).toBe(true);
    expect(markDone.proposal.type).toBe("complete_task");
    expect(markDone.proposal.target?.taskId).toBe("task-selected-fa");
  });

  it("does not silently choose a selected task when context is missing or ambiguous", () => {
    const missing = validateWithContext(
      proposal({ type: "inspect_tasks", toolId: "tasks.list" }),
      "Mark the selected task done.",
      { ...context, tasks: [] },
    );
    const ambiguous = validateWithContext(
      proposal({ type: "inspect_tasks", toolId: "tasks.list" }),
      "Markiere die ausgewählte Aufgabe als erledigt.",
      { ...context, tasks: [
        { id: "task-a", title: "A", completed: false, status: "open" },
        { id: "task-b", title: "B", completed: false, status: "open" },
      ] },
      "de",
    );
    const generic = validateWithContext(
      proposal({ type: "inspect_tasks", toolId: "tasks.list" }),
      "erledigt",
      { ...context, tasks: [] },
      "de",
    );

    expect(missing.proposal.type).toBe("ask_clarification");
    expect(ambiguous.proposal.type).toBe("ask_clarification");
    expect(generic.proposal.type).toBe("ask_clarification");
  });

  it("allows exact completed task targets so runtime can report no new change", () => {
    const result = validate(proposal({
      type: "complete_task",
      requestedDomain: "tasks",
      toolId: "tasks.complete",
      target: { taskId: "task-3" },
    }), "Complete clean desk");

    expect(result.proposal.type).toBe("complete_task");
    expect(result.proposal.target?.taskId).toBe("task-3");
  });

  it("creates localized clarification text", () => {
    const result = validateAgentIntentProposal({
      rawProposal: proposal({ confidence: "low" }),
      userMessage: "Diese Anfrage ist unklar",
      safeContext: context,
      language: "de",
      now,
    });

    expect(result.proposal.clarificationQuestion).toContain("Kannst");
  });

  it("returns language-correct clarification for low-confidence auto outputs", () => {
    const fa = validateAgentIntentProposal({
      rawProposal: proposal({ confidence: "low" }),
      userMessage: "منظورت کدام وظیفه است؟",
      safeContext: context,
      language: "fa",
      now,
    });
    const en = validateAgentIntentProposal({
      rawProposal: proposal({ confidence: "low" }),
      userMessage: "Which task?",
      safeContext: context,
      language: "en",
      now,
    });

    expect(fa.proposal.clarificationQuestion).toContain("می");
    expect(en.proposal.clarificationQuestion).toContain("clarify");
  });
});

describe("resolveDisambiguationCandidates", () => {
  // Deliberately neutral -- no task/calendar/learning/workspace/github
  // domain evidence at all -- so each explicitly-typed candidate keeps its
  // own type instead of being redirected by evidence-based normalization.
  // That isolates what this suite actually tests: validate -> dedup -> cap,
  // not the evidence-rescue behavior already covered elsewhere.
  const neutralMessage = "Please help me decide.";
  const emptyContext: AgentReasoningSafeContext = { tasks: [], events: [], learningProgress: null };

  function resolve(rawCandidates: unknown, userMessage = neutralMessage, safeContext = emptyContext) {
    return resolveDisambiguationCandidates({
      rawCandidates,
      userMessage,
      safeContext,
      language: "en",
      now,
    });
  }

  it("returns no candidates when rawCandidates is absent, malformed, or empty", () => {
    expect(resolve(undefined)).toEqual([]);
    expect(resolve("not-an-array")).toEqual([]);
    expect(resolve([])).toEqual([]);
    expect(resolve([{ type: "inspect_github_issues" }, "not-an-object"])).toEqual([]);
  });

  it("keeps two candidates with genuinely different validated types as two distinct survivors", () => {
    const result = resolve([
      { type: "inspect_github_issues", reasons: ["Message names a connected repository."] },
      { type: "inspect_github_pull_requests", reasons: ["Could also mean open pull requests."] },
    ]);
    expect(result.map((r) => r.toolId)).toEqual(["github.issues.list", "github.pulls.list"]);
  });

  it("dedups two candidates that validate to the same toolId down to one survivor", () => {
    const result = resolve([
      { type: "inspect_github_issues", reasons: ["First phrasing."] },
      { type: "inspect_github_issues", reasons: ["Differently worded, same tool."] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].toolId).toBe("github.issues.list");
  });

  it("the sole survivor of a dedup is identical to what a standalone proposal of that type would produce", () => {
    const [viaDedup] = resolve([
      { type: "inspect_github_issues", reasons: ["First phrasing."] },
      { type: "inspect_github_issues", reasons: ["Second phrasing."] },
    ]);

    const standalone = validateAgentIntentProposal({
      rawProposal: {
        id: `intent:candidate:0:${now.toISOString()}`,
        type: "inspect_github_issues",
        confidence: "medium",
        reasons: ["First phrasing."],
      },
      userMessage: neutralMessage,
      safeContext: emptyContext,
      language: "en",
      now,
    });

    expect(viaDedup).toEqual(standalone);
  });

  it("counts only validated survivors against the cap: drops the invalid candidate first, then keeps the top 3 of the 4 valid distinct ones", () => {
    const result = resolve([
      { type: "inspect_github_repositories", reasons: ["a"] },
      { type: "not_a_real_intent_type", reasons: ["b"] },
      { type: "inspect_github_issues", reasons: ["c"] },
      { type: "inspect_github_pull_requests", reasons: ["d"] },
      { type: "inspect_github_workflow_runs", reasons: ["e"] },
    ]);
    expect(result.map((r) => r.proposal.type)).toEqual([
      "inspect_github_repositories",
      "inspect_github_issues",
      "inspect_github_pull_requests",
    ]);
  });

  it("resolves to a single survivor when only one of five candidates validates -- the cap never comes into play", () => {
    const result = resolve([
      { type: "garbage_one", reasons: ["a"] },
      { type: "garbage_two", reasons: ["b"] },
      { type: "inspect_github_issues", reasons: ["c"] },
      { type: "garbage_three", reasons: ["d"] },
      { type: "garbage_four", reasons: ["e"] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].proposal.type).toBe("inspect_github_issues");
  });

  it("excludes complete_task from candidates even when it would otherwise resolve, since it requires approval", () => {
    const singleTaskContext: AgentReasoningSafeContext = {
      tasks: [{ id: "only-task", title: "Solo task", completed: false, status: "open" }],
      events: [],
      learningProgress: null,
    };
    const result = resolve(
      [
        { type: "complete_task", reasons: ["User wants to mark the selected task done."] },
        { type: "inspect_tasks", reasons: ["User might just want to see tasks."] },
      ],
      "What about the selected task?",
      singleTaskContext,
    );
    expect(result).toHaveLength(1);
    expect(result[0].proposal.type).toBe("inspect_tasks");
    expect(result[0].proposal.requiresApproval).toBe(false);
  });
});
