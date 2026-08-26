import { describe, expect, it } from "vitest";
import { ENGINEERING_TASK_CONFIRMATION_REASON_MARKER, resolveDisambiguationCandidates, validateAgentIntentProposal } from "./intentValidator";
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

function validate(rawProposal: unknown, userMessage = "What tasks do I have?", timeZone = "UTC") {
  return validateAgentIntentProposal({
    rawProposal,
    userMessage,
    safeContext: context,
    language: "en",
    now,
    timeZone,
  });
}

function validateWithContext(
  rawProposal: unknown,
  userMessage: string,
  safeContext: AgentReasoningSafeContext,
  language: SupportedAiResponseLanguage = "en",
  timeZone = "UTC",
) {
  return validateAgentIntentProposal({
    rawProposal,
    userMessage,
    safeContext,
    language,
    now,
    timeZone,
  });
}

describe("intentValidator", () => {
  it("validates inspect intent mappings", () => {
    expect(validate(proposal({ type: "inspect_tasks", toolId: "tasks.list" })).toolId).toBe("tasks.list");
    expect(validate(proposal({ type: "inspect_calendar", requestedDomain: "calendar", toolId: "calendar.list_today" }), "What is on my calendar today?").toolId).toBe("calendar.list_today");
    expect(validate(proposal({ type: "inspect_learning", requestedDomain: "learning", toolId: "learning.get_progress" }), "Show my learning progress.").toolId).toBe("learning.get_progress");
    expect(validate(proposal({ type: "inspect_workspace", requestedDomain: "workspace", toolId: "workspace.get_context" }), "Summarize my workspace.").toolId).toBe("workspace.get_context");
  });

  it("overwrites a model-supplied task due date with deterministic parsing from the user message", () => {
    const result = validateAgentIntentProposal({
      rawProposal: proposal({
        type: "create_task",
        requestedDomain: "tasks",
        toolId: "tasks.create",
        requiresApproval: true,
        target: {
          title: "\u0646\u0648\u0628\u062a \u062f\u06a9\u062a\u0631",
          dueDate: "2026-07-17",
        },
      }),
      userMessage: "\u06cc\u06a9 \u062a\u0633\u06a9 \u0628\u0631\u0627\u06cc \u0641\u0631\u062f\u0627 \u0628\u0633\u0627\u0632 \u06a9\u0647 \u0646\u0648\u0628\u062a \u062f\u06a9\u062a\u0631 \u062f\u0627\u0631\u0645",
      safeContext: context,
      language: "fa",
      now: new Date("2026-08-13T18:06:00.000Z"),
      timeZone: "Europe/Berlin",
    });

    expect(result.proposal.type).toBe("create_task");
    expect(result.proposal.target?.dueDate).toBe("2026-08-14");
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

  describe("Task 22 (calendar write slice) write intents", () => {
    it("resolves create_calendar_event only with an eventTitle and a start time, otherwise asks for clarification", () => {
      const incomplete = validate(
        proposal({ type: "create_calendar_event", requestedDomain: "calendar", toolId: "calendar.create_event" }),
        "Create an event for tomorrow",
      );
      expect(incomplete.proposal.type).toBe("ask_clarification");

      const missingStart = validate(
        proposal({
          type: "create_calendar_event",
          requestedDomain: "calendar",
          toolId: "calendar.create_event",
          target: { eventTitle: "Team sync" },
        }),
        "Create an event for tomorrow",
      );
      expect(missingStart.proposal.type).toBe("ask_clarification");

      // Task 22-fix (C1): start/end are now deterministically resolved from
      // the message (see intentValidator.ts's calendar override block),
      // never trusted from the model -- so the expected start below is
      // computed from "tomorrow at 9am" relative to `now`/UTC, not an
      // arbitrary literal the model happened to propose.
      const complete = validate(
        proposal({
          type: "create_calendar_event",
          requestedDomain: "calendar",
          toolId: "calendar.create_event",
          target: { eventTitle: "Team sync", start: "2020-01-01T00:00:00.000Z" },
        }),
        "Create an event for tomorrow at 9am called Team sync",
      );
      expect(complete.proposal.type).toBe("create_calendar_event");
      expect(complete.toolId).toBe("calendar.create_event");
      expect(complete.proposal.requiresApproval).toBe(true);
      expect(complete.proposal.target).toMatchObject({
        eventTitle: "Team sync",
        start: "2026-07-16T09:00:00.000Z",
        end: "2026-07-16T10:00:00.000Z",
      });
    });

    it("a model-supplied start/end is ALWAYS overridden by deterministic resolution, never partially trusted (C1)", () => {
      // The model proposes a wildly wrong start (a different month
      // entirely) -- mirrors the exact production evidence shape.
      const result = validate(
        proposal({
          type: "create_calendar_event",
          requestedDomain: "calendar",
          toolId: "calendar.create_event",
          target: { eventTitle: "Family doctor appointment", start: "2026-01-01T00:00:00.000Z" },
        }),
        "Create an event for tomorrow at 1pm called Family doctor appointment",
      );
      expect(result.proposal.type).toBe("create_calendar_event");
      expect(result.proposal.target?.start).not.toBe("2026-01-01T00:00:00.000Z");
      expect(result.proposal.target?.start).toBe("2026-07-16T13:00:00.000Z");
    });

    it("when the message has no deterministically resolvable date+time, the model's start/end is dropped entirely (asks for clarification) rather than shipped as-is", () => {
      const result = validate(
        proposal({
          type: "create_calendar_event",
          requestedDomain: "calendar",
          toolId: "calendar.create_event",
          target: { eventTitle: "Team sync", start: "2026-08-14T09:00:00.000Z" },
        }),
        "Create an event called Team sync",
      );
      expect(result.proposal.type).toBe("ask_clarification");
    });

    it("resolves update_calendar_event against a fuzzy-matched safe-context event, requiring at least one changed field", () => {
      const noMatch = validateWithContext(
        proposal({
          type: "update_calendar_event",
          requestedDomain: "calendar",
          toolId: "calendar.update_event",
          target: { eventReference: "Nonexistent event", start: "2026-08-14T10:00:00.000Z" },
        }),
        "Move the Nonexistent event to 10am",
        context,
      );
      expect(noMatch.proposal.type).toBe("ask_clarification");

      const noChange = validateWithContext(
        proposal({
          type: "update_calendar_event",
          requestedDomain: "calendar",
          toolId: "calendar.update_event",
          target: { eventReference: "Standup" },
        }),
        "Update the Standup event",
        context,
      );
      expect(noChange.proposal.type).toBe("ask_clarification");

      const matched = validateWithContext(
        proposal({
          type: "update_calendar_event",
          requestedDomain: "calendar",
          toolId: "calendar.update_event",
          target: { eventReference: "Standup", start: "2026-08-14T10:00:00.000Z" },
        }),
        // Task 22-fix (C1): "10:00" (colon format), not bare "10am" -- see
        // parseDeterministicTimeOfDay in deterministicDates.ts, which (like
        // its Worker counterpart) only recognizes a bare hour+am/pm when
        // preceded by "at"/"um"; a colon time needs no prefix. A genuine,
        // pre-existing parsing gap shared by both the Worker and this
        // frontend port, out of this fix's scope (not one of C1/C2/C3).
        "Move the Standup event to 10:00",
        context,
      );
      expect(matched.proposal.type).toBe("update_calendar_event");
      expect(matched.proposal.target?.eventId).toBe("event-1");
      // Task 22-fix (C1): the message only carries a new TIME ("to 10:00"),
      // no new date phrase -- deterministically anchored to the MATCHED
      // event's own existing date (2026-07-15, from its dateTimeStart),
      // never the model's bogus "2026-08-14" guess, and never silently
      // dropped either (mirrors the Worker's `intent.startDate ?? before.date`).
      expect(matched.proposal.target?.start).toBe("2026-07-15T10:00:00.000Z");
      expect(matched.proposal.target?.start).not.toBe("2026-08-14T10:00:00.000Z");
    });

    it("update_calendar_event with an explicit NEW date+time in the message overrides the existing event's date, not just its time", () => {
      const result = validateWithContext(
        proposal({
          type: "update_calendar_event",
          requestedDomain: "calendar",
          toolId: "calendar.update_event",
          target: { eventReference: "Standup", start: "2020-01-01T00:00:00.000Z" },
        }),
        "Move the Standup event to tomorrow at 11am",
        context,
      );
      expect(result.proposal.type).toBe("update_calendar_event");
      expect(result.proposal.target?.start).toBe("2026-07-16T11:00:00.000Z");
    });

    it("routes a time-bearing task-worded request to create_calendar_event, not create_task (a time forces calendar), bridging the model's task-shaped title field", () => {
      // The model proposed create_task (it saw "task" wording) and
      // populated the task-shaped title/start fields it was told to for
      // that type; the deterministic time-forces-calendar rule overrides
      // the type, and the validator bridges title->eventTitle so the
      // reclassified proposal isn't immediately rejected for a "missing"
      // title the model actually did provide, just under the other name.
      // (Deliberately avoids an incidental calendar-ish word like
      // "appointment"/"meeting" in the message -- getStrongReadDomainEvidence's
      // own, coarser task-vs-calendar evidence check treats co-occurring
      // task and calendar words ANYWHERE in the message as conflicting and
      // asks for clarification before this rule is ever reached; that is a
      // real, disclosed limitation of this validator's layered
      // disambiguation, not something this test is trying to cover.)
      const result = validate(
        proposal({
          type: "create_task",
          requestedDomain: "tasks",
          toolId: "tasks.create",
          target: { title: "Call the dentist", start: "2026-08-14T15:00:00.000Z" },
        }),
        "Create a task for tomorrow at 3pm to call the dentist",
      );
      expect(result.proposal.type).toBe("create_calendar_event");
      expect(result.proposal.target?.eventTitle).toBe("Call the dentist");
    });

    it("a date-only task-worded request still resolves to create_task, unchanged", () => {
      const result = validate(
        proposal({ type: "create_task", requestedDomain: "tasks", toolId: "tasks.create", target: { title: "Review invoices" } }),
        "Create a task for tomorrow",
      );
      expect(result.proposal.type).toBe("create_task");
    });

    it("treats a message naming both a task and a calendar concept as ambiguous, never guessing (same loose ask_clarification/unsupported contract the existing mixed-request tests use)", () => {
      const result = validate(
        proposal({ type: "ask_clarification" }),
        "Create a task for the meeting tomorrow",
      );
      expect(["ask_clarification", "unsupported"]).toContain(result.proposal.type);
      expect(result.proposal.type).not.toBe("create_task");
      expect(result.proposal.type).not.toBe("create_calendar_event");
    });

    it("still rejects a delete request for a calendar event as unsupported", () => {
      expect(validate(proposal(), "delete my calendar event please").proposal.type).toBe("unsupported");
    });
  });

  it("handles malformed or non-object output safely", () => {
    const result = validate(null);

    expect(result.proposal.type).toBe("ask_clarification");
    expect(result.proposal.requiresTool).toBe(false);
  });

  it("supports task create/update but still rejects unsupported delete and non-task writes", () => {
    expect(validate(proposal({ type: "create_task", requestedDomain: "tasks", toolId: "tasks.create", target: { title: "Review invoices" } }), "Create a task").proposal.type).toBe("create_task");
    expect(validateWithContext(proposal({ type: "update_task", requestedDomain: "tasks", toolId: "tasks.update", target: { taskReference: "Tax", dueDate: "2026-08-14" } }), "Update the Tax task", {
      tasks: [{ id: "task-1", title: "Tax", completed: false }],
      events: [],
      learningProgress: null,
    }).proposal.type).toBe("update_task");
    expect(validate(proposal({ type: "inspect_tasks" }), "Delete this task").proposal.type).toBe("unsupported");
    expect(validate(proposal({ type: "inspect_calendar", requestedDomain: "calendar", toolId: "calendar.list_today" }), "Verschiebe meinen Termin auf 15 Uhr.").proposal.type).toBe("unsupported");
    expect(validate(proposal({ type: "inspect_tasks" }), "برای فردا یک وظیفه بساز.").proposal.type).toBe("ask_clarification");
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

describe("Task 28 (finance write slice) write intents", () => {
  it("resolves create_finance_transaction only with an amount and a direction, otherwise asks for clarification", () => {
    const incomplete = validate(
      proposal({ type: "create_finance_transaction", requestedDomain: "finance", toolId: "finance.create_transaction" }),
      "Log an expense please",
    );
    expect(incomplete.proposal.type).toBe("ask_clarification");

    // The model's own proposed amount/currency/direction are IGNORED --
    // re-derived deterministically from the message instead, the same
    // "never trust the model" rule create_calendar_event's start/end
    // override already enforces above.
    const complete = validate(
      proposal({
        type: "create_finance_transaction",
        requestedDomain: "finance",
        toolId: "finance.create_transaction",
        target: { amount: "999999", currency: "USD", direction: "income" },
      }),
      "Log an expense of 45,50 € for groceries",
    );
    expect(complete.proposal.type).toBe("create_finance_transaction");
    expect(complete.toolId).toBe("finance.create_transaction");
    expect(complete.proposal.requiresApproval).toBe(true);
    expect(complete.proposal.target).toMatchObject({ amount: "45.5", currency: "EUR", direction: "expense" });
  });

  it("defaults the transaction date to today when the message names no date", () => {
    const result = validate(
      proposal({ type: "create_finance_transaction", requestedDomain: "finance", toolId: "finance.create_transaction", target: {} }),
      "Log an expense of 20 EUR",
    );
    expect(result.proposal.target?.transactionDate).toBe("2026-07-15");
  });

  it("a valid IBAN in the message survives to the target, flagged for the approval preview", () => {
    const result = validate(
      proposal({ type: "create_finance_transaction", requestedDomain: "finance", toolId: "finance.create_transaction", target: {} }),
      "Pay 45 EUR to DE89 3704 0044 0532 0130 00",
    );
    expect(result.proposal.type).toBe("create_finance_transaction");
    expect(result.proposal.target?.iban).toBe("DE89370400440532013000");
  });

  it("an IBAN that fails the mod-97 check is a typed rejection (ask_clarification), never a silent pass or a silent drop", () => {
    const result = validate(
      proposal({ type: "create_finance_transaction", requestedDomain: "finance", toolId: "finance.create_transaction" }),
      "Pay 45 EUR to DE89 3704 0044 0532 0130 01",
    );
    expect(result.proposal.type).toBe("ask_clarification");
  });

  it("a message matching both a task trigger and a finance trigger is genuinely ambiguous, not guessed -- consistent with this validator's existing (pre-task-28) behavior for any two conflicting write triggers: it falls through to read-evidence normalization and is then rejected as unsupported, rather than silently picking one", () => {
    const result = validate(
      proposal({ type: "ask_clarification" }),
      "Create a task to log an expense of 20 EUR",
    );
    expect(result.proposal.type).toBe("unsupported");
  });

  it("existing calendar/task resolution is unaffected by the finance branch's addition to the cascade", () => {
    const result = validate(
      proposal({ type: "create_task", requestedDomain: "tasks", toolId: "tasks.create", target: { title: "Buy milk" } }),
      "Create a task to buy milk",
    );
    expect(result.proposal.type).toBe("create_task");
  });
});

// Task 42: task 41-verify traced the PO's exact production phrase all the
// way through this validator -- the model's own type survives (see that
// report's probe), but target.direction (re-derived deterministically at
// the create_finance_transaction override step, never trusted from the
// model) came back undefined because no explicit expense/income word is
// present, so the !target?.direction check a few lines below downgraded the
// whole proposal to ask_clarification. Part B closes that gap by inferring
// expense from a stated spending category; these tests exercise it through
// this file's own validateAgentIntentProposal entry point, one layer above
// shared/financeDirection.test.ts's direct unit corpus.
describe("Task 42 (finance direction inference from a spending category)", () => {
  it("the PO exact production phrase now resolves to create_finance_transaction with direction=expense, not ask_clarification", () => {
    // Copied byte-for-byte from task 42's own instructions -- never retyped.
    const PO_STRING = "مبلغ ۲۵ یورو در بخش مواد غذایی اضافه کن";
    const result = validate(
      proposal({
        type: "create_finance_transaction",
        requestedDomain: "finance",
        toolId: "finance.create_transaction",
        userMessage: PO_STRING,
        language: "fa",
        target: {},
      }),
      PO_STRING,
    );
    expect(result.proposal.type).toBe("create_finance_transaction");
    expect(result.proposal.target).toMatchObject({ amount: "25", currency: "EUR", direction: "expense" });
  });

  it("an explicit income phrasing still resolves to income -- the category+verb inference never overrides an explicit word", () => {
    const result = validate(
      proposal({ type: "create_finance_transaction", requestedDomain: "finance", toolId: "finance.create_transaction", target: {} }),
      "حقوق ۵۰ یورو در بخش درآمد ثبت کن",
    );
    expect(result.proposal.type).toBe("create_finance_transaction");
    expect(result.proposal.target).toMatchObject({ direction: "income" });
  });

  it("a genuinely ambiguous finance message (amount + write verb, no category, no explicit income/expense word) still surfaces the clarification question, not a silent guess", () => {
    const result = validate(
      proposal({ type: "create_finance_transaction", requestedDomain: "finance", toolId: "finance.create_transaction", target: {} }),
      "Record a transaction of 20 EUR",
    );
    expect(result.proposal.type).toBe("ask_clarification");
    expect(result.proposal.clarificationQuestion).toBeTruthy();
    // Specifically direction-missing, not amount-missing -- proves this
    // case is the one Part B's inference deliberately still leaves
    // unresolved, not an unrelated failure mode.
    expect(result.proposal.reasons).toContain("Whether this is income or an expense is required before recording a transaction.");
  });
});

describe("Task 45c, ADR-0017 (import_bank_statement is UI-only, never chat-proposable)", () => {
  it("rejects import_bank_statement as unsupported, even with a well-formed-looking batchId target", () => {
    const result = validate(
      proposal({
        type: "import_bank_statement",
        requestedDomain: "finance",
        toolId: "finance.import_bank_statement",
        target: { batchId: "batch-123" },
      }),
      "import my bank statement",
    );
    expect(result.proposal.type).toBe("unsupported");
  });

  it("rejects it even with no target at all", () => {
    const result = validate(
      proposal({ type: "import_bank_statement", requestedDomain: "finance", toolId: "finance.import_bank_statement" }),
      "import my bank statement",
    );
    expect(result.proposal.type).toBe("unsupported");
  });

  it("never offers a clarification question for it -- there is nothing the user could supply via chat to fix this", () => {
    const result = validate(
      proposal({ type: "import_bank_statement", requestedDomain: "finance", toolId: "finance.import_bank_statement" }),
      "import my bank statement",
    );
    expect(result.proposal.requiresApproval).toBe(false);
    expect(result.proposal.requiresTool).toBe(false);
  });

  it("rejects it regardless of message wording -- not gated on any particular trigger phrase, since none exists for this intent", () => {
    const result = validate(
      proposal({ type: "import_bank_statement", requestedDomain: "finance", toolId: "finance.import_bank_statement" }),
      "hello",
    );
    expect(result.proposal.type).toBe("unsupported");
  });

  it("a normal finance message is unaffected by this guard (proves the guard is scoped to the one type, not a broader finance regression)", () => {
    const result = validate(
      proposal({ type: "create_finance_transaction", requestedDomain: "finance", toolId: "finance.create_transaction", target: {} }),
      "I spent 20 EUR on coffee",
    );
    expect(result.proposal.type).toBe("create_finance_transaction");
  });

  // ENG-06d: requestLooksLikeEngineeringTask matched English and Persian
  // but not German. Scope of the gap, established by these tests rather
  // than assumed: propose_engineering_task is in
  // CONFIRMED_WRITE_INTENT_TYPES, so a type the MODEL already returned
  // survives normalization in any language. What the gate actually
  // controls is the PROMOTION path -- rescuing an ask_clarification into
  // propose_engineering_task when the user's own message unambiguously
  // asks for one. German users lost that rescue entirely: the model
  // hedging on a German request produced a clarification question instead
  // of an approval card, where the identical English or Persian request
  // produced the card.
  describe("ENG-06d: German engineering-task phrasing promotes a hedged clarification", () => {
    // Type is ask_clarification -- the model hedged. Only the phrase gate
    // can promote this to propose_engineering_task, so this exercises the
    // German patterns directly and fails without them.
    const hedgedProposal = (userMessage: string) => ({
      id: "intent-eng",
      type: "ask_clarification",
      confidence: "medium",
      userMessage,
      requestedDomain: "github",
      target: {
        repo: "aryanbarak/smartflow",
        engineeringInstruction: "Erhöhe das Zeitlimit für die Reasoning-Anfrage.",
        engineeringTaskClass: "fix",
      },
      requiresTool: false,
      requiresApproval: false,
      clarificationQuestion: "Was genau meinst du?",
      reasons: ["Das Modell war unsicher."],
      language: "de",
      generatedAt: now.toISOString(),
      schemaVersion: 1,
    });

    it.each([
      ["Führe bitte eine Entwicklungsaufgabe auf aryanbarak/smartflow aus."],
      ["Bitte eine Programmieraufgabe auf aryanbarak/smartflow starten."],
      ["Bitte Claude Code ausführen auf aryanbarak/smartflow."],
      ["Starte einen Engineering-Task auf aryanbarak/smartflow."],
    ])("promotes a hedged clarification for German phrasing: %s", (userMessage) => {
      const result = validateWithContext(hedgedProposal(userMessage), userMessage, context, "de");

      expect(result.proposal.type).toBe("propose_engineering_task");
      expect(result.proposal.toolId).toBe("engineering.task.propose");
    });

    // Parity check: the identical hedge in English already promoted before
    // this fix -- pins that German now behaves the same, rather than
    // asserting German works in isolation.
    it("matches the pre-existing English behaviour for the same hedge", () => {
      const userMessage = "Please run an engineering task on aryanbarak/smartflow.";
      const result = validateWithContext(hedgedProposal(userMessage), userMessage, context, "en");

      expect(result.proposal.type).toBe("propose_engineering_task");
    });

    // The gate stays deliberately narrow (ENG-04: a false positive here
    // proposes an unattended, real-repo, real-money coding-agent run) --
    // an everyday German verb must NOT promote a hedge into one.
    it.each([
      ["Kannst du das bitte reparieren?"],
      ["Bitte baue mir eine Übersicht."],
      ["Kannst du diese Aufgabe erledigen?"],
    ])("does not promote on everyday German phrasing: %s", (userMessage) => {
      const result = validateWithContext(hedgedProposal(userMessage), userMessage, context, "de");

      expect(result.proposal.type).not.toBe("propose_engineering_task");
    });
  });

  // ENG-06g. Root cause, reproduced against this validator before the fix:
  // requestLooksUnsupported() matches bare generic verbs (add/create/update
  // in English, اضافه کن/بساز in Persian), which any "add a line to
  // README.md in <repo>" request satisfies by definition. That made the
  // outcome depend entirely on whether the model's own type happened to
  // land inside CONFIRMED_WRITE_INTENT_TYPES -- for a byte-identical
  // message, propose_engineering_task produced an approval card while
  // ask_clarification / inspect_github_repositories / unsupported all
  // produced "Flow AI doesn't support this". Since ENG-04 shipped the
  // capability, that sentence is false, and the user hit it on roughly one
  // classification in three.
  describe("ENG-06g: a hedged engineering-task response asks, it does not deny the capability", () => {
    // Natural phrasing on purpose: contains a generic write verb and NOT
    // the literal trigger phrase requestLooksLikeEngineeringTask wants.
    // Widening that gate is the arms race this fix deliberately avoids.
    const FA_MESSAGE = "در مخزن smartflow یک خط به فایل README.md اضافه کن";
    const EN_MESSAGE = "add a line to README.md in the smartflow repo";

    const shapedTarget = {
      repo: "aryanbarak/smartflow",
      engineeringInstruction: "Add a line to README.md describing the reasoning lane.",
      engineeringTaskClass: "fix",
    };

    const responseWithType = (type: string, userMessage: string, language: "en" | "fa") => ({
      id: "intent-eng-06g",
      type,
      confidence: "high",
      userMessage,
      requestedDomain: "github",
      target: shapedTarget,
      requiresTool: true,
      requiresApproval: true,
      reasons: ["Model output."],
      language,
      generatedAt: now.toISOString(),
      schemaVersion: 1,
    });

    // The primary variant is unchanged -- the fix must not disturb the
    // path that already worked.
    it.each([
      ["fa", FA_MESSAGE],
      ["en", EN_MESSAGE],
    ])("still proposes the engineering task when the model returns propose_engineering_task (%s)", (language, userMessage) => {
      const result = validateWithContext(
        responseWithType("propose_engineering_task", userMessage, language as "en" | "fa"),
        userMessage,
        context,
        language as SupportedAiResponseLanguage,
      );

      expect(result.proposal.type).toBe("propose_engineering_task");
      expect(result.proposal.reasons).not.toContain(ENGINEERING_TASK_CONFIRMATION_REASON_MARKER);
    });

    // The three variants that used to deny the capability.
    it.each([
      ["ask_clarification", "fa", FA_MESSAGE],
      ["ask_clarification", "en", EN_MESSAGE],
      ["inspect_github_repositories", "fa", FA_MESSAGE],
      ["inspect_github_repositories", "en", EN_MESSAGE],
      ["unsupported", "fa", FA_MESSAGE],
      ["unsupported", "en", EN_MESSAGE],
    ])("routes a hedged %s (%s) to an honest confirmation, never to the capability denial", (type, language, userMessage) => {
      const result = validateWithContext(
        responseWithType(type, userMessage, language as "en" | "fa"),
        userMessage,
        context,
        language as SupportedAiResponseLanguage,
      );

      // The whole point: NOT 'unsupported', which is what renders
      // UNSUPPORTED_CAPABILITY_TEXT ("Flow AI doesn't support this").
      expect(result.proposal.type).toBe("ask_clarification");
      expect(result.proposal.type).not.toBe("unsupported");
      expect(result.proposal.reasons).toContain(ENGINEERING_TASK_CONFIRMATION_REASON_MARKER);
      expect(result.proposal.reasons).not.toContain("Unsupported action was rejected.");
      // It must be a real question the user can answer.
      expect(result.proposal.clarificationQuestion).toBeTruthy();
    });

    // ENG-04's safety bar: this is a QUESTION, not a promotion. A false
    // positive on the promotion path launches an unattended coding-agent
    // run against a real repository, so the hedged case must never acquire
    // a tool or an approval.
    it.each([
      ["ask_clarification"],
      ["inspect_github_repositories"],
      ["unsupported"],
    ])("never promotes a hedged %s to an executable proposal", (type) => {
      const result = validateWithContext(
        responseWithType(type, FA_MESSAGE, "fa"),
        FA_MESSAGE,
        context,
        "fa",
      );

      expect(result.proposal.type).not.toBe("propose_engineering_task");
      expect(result.proposal.requiresTool).toBe(false);
      expect(result.proposal.requiresApproval).toBe(false);
      expect(result.proposal.toolId).toBeUndefined();
    });

    it("asks in the caller's own language", () => {
      const fa = validateWithContext(responseWithType("ask_clarification", FA_MESSAGE, "fa"), FA_MESSAGE, context, "fa");
      const en = validateWithContext(responseWithType("ask_clarification", EN_MESSAGE, "en"), EN_MESSAGE, context, "en");

      expect(fa.proposal.clarificationQuestion).toContain("تسک مهندسی");
      expect(en.proposal.clarificationQuestion).toContain("engineering task");
    });

    // The regression guard the fix is most likely to break: a genuinely
    // unsupported request must still be told so. Same generic write verb,
    // no engineering-task-shaped target at all.
    it.each([
      ["no target at all", undefined],
      ["a target with neither repo nor instruction", { title: "buy milk" }],
      ["a repo with no instruction", { repo: "aryanbarak/smartflow" }],
      ["an instruction with no repo", { engineeringInstruction: "Add a line to README.md." }],
    ])("still reports a genuinely unsupported request as unsupported when the target has %s", (_label, target) => {
      const userMessage = "send a postcard to my accountant and pay the invoice";
      const raw = {
        id: "intent-unsupported",
        type: "unsupported",
        confidence: "high",
        userMessage,
        target,
        requiresTool: false,
        requiresApproval: false,
        reasons: ["Model output."],
        language: "en",
        generatedAt: now.toISOString(),
        schemaVersion: 1,
      };

      const result = validateWithContext(raw, userMessage, context, "en");

      expect(result.proposal.type).toBe("unsupported");
      expect(result.proposal.reasons).toContain("Unsupported action was rejected.");
      expect(result.proposal.reasons).not.toContain(ENGINEERING_TASK_CONFIRMATION_REASON_MARKER);
    });
  });
});
