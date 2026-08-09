

import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import {
  ChatBubble,
  classifyMessageIntentSignal,
  getAmbiguousOfferHint,
  getAmbiguousOfferText,
  liveTaskReasoningContext,
  proposalMessage,
  proposalsToStates,
  proposalToState,
  ReasoningProposalCard,
  resultMessage,
  runtimeSummaryMessage,
  shouldUseReasoningForMessage,
} from "./ChatPage";
import { getStrongReadDomainEvidence, getToolById } from "@/features/agent";
import type {
  AgentReasoningResult,
  ToolResolutionResult,
} from "@/features/agent";
import type {
  WorkspacePlanStep,
  WorkspaceStepApproval,
} from "@/features/workspace";

const now = "2026-07-15T08:00:00.000Z";

function reasoningResult(
  type: AgentReasoningResult["proposal"]["type"] = "inspect_tasks",
  toolId: AgentReasoningResult["toolId"] = type === "complete_task" ? "tasks.complete" : "tasks.list",
): AgentReasoningResult {
  return {
    proposal: {
      id: "intent-1",
      type,
      confidence: "high",
      userMessage: "Show my open tasks.",
      requestedDomain: "tasks",
      toolId,
      target: type === "complete_task"
        ? { taskId: "task-secret-1", taskTitleHint: "Submit application" }
        : undefined,
      requiresTool: true,
      requiresApproval: type === "complete_task",
      reasons: ["Validated."],
      language: "en",
      generatedAt: now,
      schemaVersion: 1,
    },
    responseLanguage: "en",
    validationReasons: ["validated"],
    toolId,
    rawModelText: "{}",
    promptPreview: {
      containsTasks: true,
      containsEvents: false,
      containsLearning: false,
      containsWorkspace: false,
    },
  };
}

function step(type: AgentReasoningResult["proposal"]["type"]): WorkspacePlanStep {
  return {
    id: "reasoning-step:intent-1",
    order: 1,
    title: type === "complete_task" ? "Complete task" : "Inspect tasks",
    description: type === "complete_task" ? "Mark Submit application as complete." : "Run tasks.list.",
    domain: "tasks",
    estimatedMinutes: 5,
    status: "proposed",
    actionType: type === "complete_task" ? "complete" : "review",
    targetId: type === "complete_task" ? "task-secret-1" : undefined,
    reason: "Validated.",
    requiresApproval: type === "complete_task",
    dependencies: [],
    optional: false,
  };
}

function resolution(toolId = "tasks.list"): ToolResolutionResult {
  return {
    status: "resolved",
    resolved: true,
    stepId: "reasoning-step:intent-1",
    toolId,
    tool: getToolById(toolId),
    confidence: "high",
    reasons: ["resolved"],
    candidates: [],
    requiredInput: [],
    generatedAt: now,
    resolverVersion: "tool-resolver-v1",
  };
}

function approval(status: WorkspaceStepApproval["status"] = "pending"): WorkspaceStepApproval {
  return {
    stepId: "reasoning-step:intent-1",
    targetId: "task-secret-1",
    toolId: "tasks.complete",
    status,
    requiresApproval: true,
    approvalReason: "Explicit approval is required.",
    riskLevel: "medium",
    reversible: true,
    externalEffect: true,
    dataDomains: ["tasks"],
    approvalScope: "single_step",
  };
}

describe("ChatPage LLM reasoning UX boundary", () => {
  it("uses live task context when loading completed with non-empty tasks", () => {
    const result = liveTaskReasoningContext({
      tasks: [{ id: "live-1", title: "Live task", completed: false, createdAt: now }],
      isLoading: false,
      error: null,
    });

    expect(result).toEqual([{
      id: "live-1",
      title: "Live task",
      completed: false,
      status: "open",
      dueDate: undefined,
      createdAt: now,
    }]);
  });

  it("treats true empty live tasks as authoritative instead of falling back to stale workspace tasks", () => {
    const result = liveTaskReasoningContext({
      tasks: [],
      isLoading: false,
      error: null,
    });

    expect(result).toEqual([]);
  });

  it("does not manufacture exact task context while live tasks are loading", () => {
    const result = liveTaskReasoningContext({
      tasks: [{ id: "stale-1", title: "Stale task", completed: false, createdAt: now }],
      isLoading: true,
      error: null,
    });

    expect(result).toEqual([]);
  });

  it("does not manufacture exact task context when live tasks failed to load", () => {
    const result = liveTaskReasoningContext({
      tasks: [{ id: "stale-1", title: "Stale task", completed: false, createdAt: now }],
      isLoading: false,
      error: "Failed to load tasks",
    });

    expect(result).toEqual([]);
  });

  it("does not route ordinary educational conversation into intent mode", () => {
    expect(shouldUseReasoningForMessage("Why is task management important?")).toBe(false);
    expect(shouldUseReasoningForMessage("Explain how calendars work.")).toBe(false);
    expect(shouldUseReasoningForMessage("What is spaced repetition?")).toBe(false);
    expect(shouldUseReasoningForMessage("Tell me about productivity systems.")).toBe(false);
    expect(shouldUseReasoningForMessage("درباره سیستم‌های بهره‌وری توضیح بده.")).toBe(false);
  });

  it("does not route greetings, thanks, or acknowledgements into intent mode", () => {
    expect(shouldUseReasoningForMessage("Hello, how are you today?")).toBe(false);
    expect(shouldUseReasoningForMessage("Thanks, that was helpful!")).toBe(false);
    expect(shouldUseReasoningForMessage("Hi there!")).toBe(false);
    expect(shouldUseReasoningForMessage("Ok, got it, thanks.")).toBe(false);
    expect(shouldUseReasoningForMessage("Hallo, wie geht es dir?")).toBe(false);
    expect(shouldUseReasoningForMessage("Danke, das war hilfreich!")).toBe(false);
    expect(shouldUseReasoningForMessage("سلام، چطوری؟")).toBe(false);
    expect(shouldUseReasoningForMessage("ممنونم، خیلی کمک کرد.")).toBe(false);
  });

  it("routes arbitrary tool phrasing never seen before into reasoning, since the allowlist is gone", () => {
    expect(shouldUseReasoningForMessage("Check the status of my project rollout")).toBe(true);
    expect(shouldUseReasoningForMessage("Can you look into the widget inventory for me?")).toBe(true);
    expect(shouldUseReasoningForMessage("Kannst du den Status meines Projekts pruefen?")).toBe(true);
    expect(shouldUseReasoningForMessage("می‌تونی وضعیت پروژه من رو بررسی کنی؟")).toBe(true);
  });

  it("does not let a greeting/thanks/acknowledgement word thrown in as a prefix disqualify a real request", () => {
    expect(shouldUseReasoningForMessage("ok show me my repositories")).toBe(true);
    expect(shouldUseReasoningForMessage("Great, now list my open issues")).toBe(true);
    expect(shouldUseReasoningForMessage("thanks, and what tasks do I have?")).toBe(true);
  });

  it("routes natural supported action phrasing into intent mode", () => {
    expect(shouldUseReasoningForMessage("What tasks do I have today?")).toBe(true);
    expect(shouldUseReasoningForMessage("Welche Aufgaben habe ich heute?")).toBe(true);
    expect(shouldUseReasoningForMessage("امروز چه کارهایی دارم؟")).toBe(true);
    expect(shouldUseReasoningForMessage("امروز چه کارهایی دارم و به فارسی جواب بده")).toBe(true);
    expect(shouldUseReasoningForMessage("امروز چه کارهایی دارم؟")).toBe(true);
    expect(shouldUseReasoningForMessage("What is on my calendar today?")).toBe(true);
    expect(shouldUseReasoningForMessage("Show my connected GitHub repositories.")).toBe(true);
    expect(shouldUseReasoningForMessage("Zeige meine verbundenen GitHub-Repositories.")).toBe(true);
    expect(shouldUseReasoningForMessage("مخزن‌های متصل گیت‌هاب را نشان بده.")).toBe(true);
    expect(shouldUseReasoningForMessage("Show me my repositories")).toBe(true);
    expect(shouldUseReasoningForMessage("list my repos")).toBe(true);
    expect(shouldUseReasoningForMessage("Zeige meine Repositories")).toBe(true);
    expect(shouldUseReasoningForMessage("مخزن‌های من را نشان بده")).toBe(true);
    expect(shouldUseReasoningForMessage("Show my open GitHub issues.")).toBe(true);
    expect(shouldUseReasoningForMessage("Zeige meine offenen GitHub-Issues.")).toBe(true);
    expect(shouldUseReasoningForMessage("ایشوهای باز گیت‌هاب را نشان بده.")).toBe(true);
    expect(shouldUseReasoningForMessage("Show my open pull requests.")).toBe(true);
    expect(shouldUseReasoningForMessage("Zeige meine offenen Pull-Requests.")).toBe(true);
    expect(shouldUseReasoningForMessage("Zeige meine GitHub-Workflow-Runs.")).toBe(true);
  });

  it("routes a 'what is' / 'چیست' question into intent mode when it's possessive, not just explanatory", () => {
    // Regression coverage for the ordinaryConversation gate: it used to
    // exempt "what is X" from ordinary-conversation only when X matched a
    // hardcoded list of known tool phrases ("on my calendar", "my tasks",
    // ...), so a genuinely new tool request phrased as a question ("What is
    // my GitHub Actions CI status?") was silently swallowed into plain chat.
    // The gate now checks for a possessive marker ("my" / "من") instead of
    // an enumerated domain list, so this works without the gate knowing
    // anything about GitHub Actions specifically.
    expect(shouldUseReasoningForMessage("What is my GitHub Actions CI status?")).toBe(true);
    expect(shouldUseReasoningForMessage("Was ist mein GitHub Actions Status?")).toBe(true);
    expect(shouldUseReasoningForMessage("وضعیت اجراهای گیت‌هاب من چیست؟")).toBe(true);
    // Still ordinary without possession: generic/explanatory "what is" stays chat.
    expect(shouldUseReasoningForMessage("What is GitHub Actions?")).toBe(false);
  });

  it("recognizes Persian's enclitic possessive suffix, not just the standalone word من", () => {
    // Persian marks possession on the noun itself (برنامه‌ام = "my plan"),
    // not with a free-standing word the way English "my" works — a bare
    // "من" check misses this shape entirely, which is the common case in
    // natural Persian phrasing, not an edge case.
    expect(shouldUseReasoningForMessage("برنامه‌ام چیست؟")).toBe(true);
    expect(shouldUseReasoningForMessage("وضعیت issue‌هایم چیست؟")).toBe(true);
    // No possessive marker in any form: stays ordinary.
    expect(shouldUseReasoningForMessage("الگوریتم مرتب‌سازی چیست؟")).toBe(false);
  });

  it("recognizes خودم/خودت/... as standalone Persian possessive-emphasis words, not just من", () => {
    expect(shouldUseReasoningForMessage("وضعیت issue‌های خودم چیست؟")).toBe(true);
    expect(shouldUseReasoningForMessage("برنامه خودم چیست؟")).toBe(true);
  });

  it("classifyMessageIntentSignal EXPLICIT: named case -- 'Show my learning progress' stays explicit, unchanged", () => {
    expect(classifyMessageIntentSignal("Show my learning progress")).toBe("explicit");
  });

  it("classifyMessageIntentSignal EXPLICIT: imperative status-check requests are unaffected by the new ambiguous carve-out", () => {
    // Same messages as the existing "arbitrary tool phrasing" test above --
    // these have an imperative verb ("check", "look into", "pruefen",
    // "بررسی کنی"), not a narrative "how is X doing" shape, so they are not
    // touched by the new narrative-status-inquiry carve-out.
    expect(classifyMessageIntentSignal("Check the status of my project rollout")).toBe("explicit");
    expect(classifyMessageIntentSignal("Kannst du den Status meines Projekts pruefen?")).toBe("explicit");
    expect(classifyMessageIntentSignal("می‌تونی وضعیت پروژه من رو بررسی کنی؟")).toBe("explicit");
  });

  it("classifyMessageIntentSignal CONVERSATIONAL: named case -- the Product Owner's FIAE-exam study-help screenshot", () => {
    expect(classifyMessageIntentSignal("Help me study and review a concept for my FIAE exam.")).toBe("conversational");
  });

  it("classifyMessageIntentSignal CONVERSATIONAL: study-help phrasing in German and Persian", () => {
    expect(classifyMessageIntentSignal("Hilf mir beim Lernen für meine Prüfung.")).toBe("conversational");
    expect(classifyMessageIntentSignal("کمک کن برای امتحانم مطالعه کنم.")).toBe("conversational");
  });

  it("classifyMessageIntentSignal AMBIGUOUS: named canonical case -- 'How is my project doing?'", () => {
    expect(classifyMessageIntentSignal("How is my project doing?")).toBe("ambiguous");
  });

  it("classifyMessageIntentSignal AMBIGUOUS: German and Persian equivalents of the canonical project-status case", () => {
    expect(classifyMessageIntentSignal("Wie läuft mein Projekt?")).toBe("ambiguous");
    expect(classifyMessageIntentSignal("پروژه‌ام چطور پیش می‌رود؟")).toBe("ambiguous");
  });

  it("classifyMessageIntentSignal: a narrative status-inquiry naming a concrete domain is NOT demoted -- stays explicit", () => {
    // "tasks" is concrete domain evidence -- the narrative shape alone never
    // demotes a message that also names a real tool.
    expect(classifyMessageIntentSignal("How are my tasks doing?")).toBe("explicit");
  });

  it("classifyMessageIntentSignal agrees with the boolean shouldUseReasoningForMessage wrapper", () => {
    expect(classifyMessageIntentSignal("Show me my repositories")).toBe("explicit");
    expect(classifyMessageIntentSignal("Hello, how are you today?")).toBe("conversational");
    expect(classifyMessageIntentSignal("Why is task management important?")).toBe("conversational");
  });

  it("getAmbiguousOfferHint/getAmbiguousOfferText: offers GitHub for a project-status narrative, in the reply's own language", () => {
    expect(getAmbiguousOfferHint("How is my project doing?")).toBe("github");
    expect(getAmbiguousOfferText("github", "en")).toMatch(/github/i);
    expect(getAmbiguousOfferText("github", "de")).toMatch(/github/i);
    expect(getAmbiguousOfferText("github", "fa")).toMatch(/گیت.?هاب/i);
  });

  it("getAmbiguousOfferHint: offers nothing when the ambiguous message names no mapped hint -- a valid, offer-less outcome", () => {
    expect(getAmbiguousOfferHint("How is my day going?")).toBeNull();
  });

  it("German 'offen' fix: no longer false-positives on an unrelated 'offen' with no task/issue/PR noun nearby", () => {
    // Previously: bare "offen"/"offene"/"offenen" alone evidenced the tasks
    // domain regardless of context. "Ist die Bibliothek offen?" ("Is the
    // library open?") has nothing to do with tasks.
    expect(getStrongReadDomainEvidence("Ist die Bibliothek heute offen?")).toBeNull();
    expect(getStrongReadDomainEvidence("Der Laden ist noch offen.")).toBeNull();
  });

  it("German 'offen' fix: still evidences the tasks domain when 'offen' co-occurs with a task/issue/PR noun", () => {
    expect(getStrongReadDomainEvidence("Zeige meine offenen Aufgaben.")).toBe("tasks");
    expect(getStrongReadDomainEvidence("Wie viele Aufgaben sind noch offen?")).toBe("tasks");
  });

  it("resolves inspect_github_issues via expectedToolId pass-through, even though it has no domain+actionType mapping", () => {
    // github.issues.list deliberately has no explicitReadOnlyMappings entry
    // (see toolResolver.ts) — this only resolves because proposalToState
    // passes expectedToolId straight from intentToolMap.
    const t = (key: string) => key;
    const result = reasoningResult("inspect_github_issues", "github.issues.list");
    const state = proposalToState(result, t);

    expect(state.resolution?.status).toBe("resolved");
    expect(state.resolution?.toolId).toBe("github.issues.list");
  });

  it.each([
    ["inspect_github_pull_requests", "github.pulls.list"],
    ["inspect_github_workflow_runs", "github.workflow_runs.list"],
  ] as const)("resolves %s via expectedToolId pass-through, even though it has no domain+actionType mapping", (type, toolId) => {
    const t = (key: string) => key;
    const result = reasoningResult(type, toolId);
    const state = proposalToState(result, t);

    expect(state.resolution?.status).toBe("resolved");
    expect(state.resolution?.toolId).toBe(toolId);
  });

  it("resolves every existing read intent to the same toolId intentValidator already assigned it", () => {
    // proposalToState now passes expectedToolId: result.toolId into
    // resolveToolForStep, short-circuiting its domain+actionType lookup.
    // For every intent already in production, the resolved toolId must be
    // identical to what intentToolMap in intentValidator.ts assigned — if
    // any of these differ, that's a pre-existing disagreement between
    // intentToolMap and explicitReadOnlyMappings, not a new regression.
    const t = (key: string) => key;
    const cases: Array<[AgentReasoningResult["proposal"]["type"], string]> = [
      ["inspect_tasks", "tasks.list"],
      ["inspect_calendar", "calendar.list_today"],
      ["inspect_learning", "learning.get_progress"],
      ["inspect_workspace", "workspace.get_context"],
      ["inspect_github_repositories", "github.repositories.list"],
    ];

    for (const [type, toolId] of cases) {
      const result = reasoningResult(type, toolId as AgentReasoningResult["toolId"]);
      const state = proposalToState(result, t);

      expect(state.resolution?.status).toBe("resolved");
      expect(state.resolution?.toolId).toBe(toolId);
    }
  });

  it("resolves write_github_issue_comment generically (previously hardcoded to tasks.complete) and previews the exact comment body", () => {
    const t = (key: string) => key;
    const result: AgentReasoningResult = {
      ...reasoningResult("write_github_issue_comment", "github.issues.comment"),
      proposal: {
        ...reasoningResult("write_github_issue_comment", "github.issues.comment").proposal,
        target: { repo: "aryan/smartflow", issueNumber: 5, commentBody: "Thanks, looking into this." },
        requiresApproval: true,
      },
    };
    const state = proposalToState(result, t);

    expect(state.resolution?.status).toBe("resolved");
    expect(state.resolution?.toolId).toBe("github.issues.comment");
    expect(state.approval?.toolId).toBe("github.issues.comment");
    expect(state.approval?.previewText).toBe("Thanks, looking into this.");
    expect(state.approval?.status).toBe("pending");
    expect(state.runStatus).toBe("approval_required");
  });

  it("resolves write_github_issue_update generically and previews the exact label/title/body change", () => {
    const t = (key: string) => key;
    const result: AgentReasoningResult = {
      ...reasoningResult("write_github_issue_update", "github.issues.update"),
      proposal: {
        ...reasoningResult("write_github_issue_update", "github.issues.update").proposal,
        target: { repo: "aryan/smartflow", issueNumber: 5, updateLabels: ["bug", "priority:high"] },
        requiresApproval: true,
      },
    };
    const state = proposalToState(result, t);

    expect(state.resolution?.status).toBe("resolved");
    expect(state.resolution?.toolId).toBe("github.issues.update");
    expect(state.approval?.toolId).toBe("github.issues.update");
    expect(state.approval?.previewText).toContain("bug, priority:high");
    expect(state.runStatus).toBe("approval_required");
  });

  it("does not build an approval for a write proposal missing its required target fields", () => {
    const t = (key: string) => key;
    const result: AgentReasoningResult = {
      ...reasoningResult("write_github_issue_comment", "github.issues.comment"),
      proposal: {
        ...reasoningResult("write_github_issue_comment", "github.issues.comment").proposal,
        target: { repo: "aryan/smartflow", issueNumber: 5 },
        requiresApproval: true,
      },
    };
    const state = proposalToState(result, t);

    expect(state.approval).toBeNull();
  });

  it("proposalsToStates returns a single-element array for a normal proposal with no disambiguationCandidates", () => {
    const t = (key: string) => key;
    const result = reasoningResult("inspect_github_issues", "github.issues.list");
    const states = proposalsToStates(result, t);

    expect(states).toHaveLength(1);
    expect(states[0].result).toBe(result);
  });

  it("proposalsToStates returns a single-element array when disambiguationCandidates has fewer than 2 entries", () => {
    const t = (key: string) => key;
    const result = {
      ...reasoningResult("inspect_github_issues", "github.issues.list"),
      disambiguationCandidates: [],
    };
    const states = proposalsToStates(result, t);

    expect(states).toHaveLength(1);
    expect(states[0].result).toBe(result);
  });

  it("proposalsToStates returns one state per candidate, each built the same way a standalone proposal would be, for 2 or more", () => {
    // resolveToolForStep stamps generatedAt from a real new Date() when no
    // currentTime is given, so two independent calls a few microseconds
    // apart otherwise produce non-identical timestamps -- freeze time so
    // this is a true structural comparison, not a timing flake.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    try {
      const t = (key: string) => key;
      const candidateA = reasoningResult("inspect_github_issues", "github.issues.list");
      const candidateB = reasoningResult("inspect_github_pull_requests", "github.pulls.list");
      const result = {
        ...reasoningResult("ask_clarification"),
        disambiguationCandidates: [candidateA, candidateB],
      };
      const states = proposalsToStates(result, t);

      expect(states).toHaveLength(2);
      expect(states[0].result).toBe(candidateA);
      expect(states[1].result).toBe(candidateB);
      // Each is built via the exact same proposalToState path a lone
      // proposal uses -- proven by comparing against calling it directly.
      expect(states[0]).toEqual(proposalToState(candidateA, t));
      expect(states[1]).toEqual(proposalToState(candidateB, t));
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a safe read-only action card without executing or exposing internals", () => {
    const onRunReadOnly = vi.fn();
    const html = renderToString(
      <ReasoningProposalCard
        proposal={{
          result: reasoningResult("inspect_tasks"),
          step: step("inspect_tasks"),
          resolution: resolution("tasks.list"),
          approval: null,
          runStatus: "idle",
        }}
        onRunReadOnly={onRunReadOnly}
        onReviewApproval={vi.fn()}
        onRunWrite={vi.fn()}
      />,
    );

    expect(html).toContain("Interpreted intent");
    expect(html).toContain("List tasks");
    expect(html).toContain("Read-only");
    expect(html).not.toContain("Confidence");
    expect(html).not.toContain("high");
    expect(html).not.toContain("task-secret-1");
    expect(html).not.toContain("requestId");
    expect(html).not.toContain("schema");
    expect(onRunReadOnly).not.toHaveBeenCalled();
  });

  it("keeps approval and write execution separated for complete_task", () => {
    const pendingHtml = renderToString(
      <ReasoningProposalCard
        proposal={{
          result: reasoningResult("complete_task"),
          step: step("complete_task"),
          resolution: resolution("tasks.complete"),
          approval: approval("pending"),
          runStatus: "approval_required",
        }}
        onRunReadOnly={vi.fn()}
        onReviewApproval={vi.fn()}
        onRunWrite={vi.fn()}
      />,
    );
    const approvedHtml = renderToString(
      <ReasoningProposalCard
        proposal={{
          result: reasoningResult("complete_task"),
          step: step("complete_task"),
          resolution: resolution("tasks.complete"),
          approval: approval("approved"),
          runStatus: "approved",
        }}
        onRunReadOnly={vi.fn()}
        onReviewApproval={vi.fn()}
        onRunWrite={vi.fn()}
      />,
    );

    expect(pendingHtml).toContain("Review approval");
    expect(pendingHtml).not.toContain(">Complete task</button>");
    expect(approvedHtml).toContain("Complete task");
  });

  // Regression test for a bug where writeResolutionForStep/approvalForReasoningStep
  // were generalized for every write tool, but ReasoningProposalCard's button
  // gating still hardcoded `type === "complete_task"`. That let a
  // write_github_issue_comment proposal render the plain read-only run button
  // (wired to onRunReadOnly, which no-ops on any requiresApproval proposal)
  // instead of "Review approval", so Run silently did nothing and the
  // previewText panel was never reachable. Built through the real
  // proposalToState path, like the resolver tests above, not hand-assembled
  // step/resolution/approval fixtures, so it exercises the exact same
  // data ReasoningProposalCard receives in the app.
  it("routes a github.issues.comment write proposal through the approval dialog, not the read-only run button", () => {
    const t = (key: string) => key;
    const result: AgentReasoningResult = {
      ...reasoningResult("write_github_issue_comment", "github.issues.comment"),
      proposal: {
        ...reasoningResult("write_github_issue_comment", "github.issues.comment").proposal,
        target: { repo: "aryan/smartflow", issueNumber: 5, commentBody: "Thanks, looking into this." },
        requiresApproval: true,
      },
    };
    const pendingState = proposalToState(result, t);
    const approvedState = {
      ...pendingState,
      approval: pendingState.approval ? { ...pendingState.approval, status: "approved" as const } : null,
      runStatus: "approved" as const,
    };

    const onRunReadOnly = vi.fn();
    const onReviewApproval = vi.fn();
    const onRunWrite = vi.fn();

    const pendingHtml = renderToString(
      <ReasoningProposalCard
        proposal={pendingState}
        onRunReadOnly={onRunReadOnly}
        onReviewApproval={onReviewApproval}
        onRunWrite={onRunWrite}
      />,
    );
    const approvedHtml = renderToString(
      <ReasoningProposalCard
        proposal={approvedState}
        onRunReadOnly={onRunReadOnly}
        onReviewApproval={onReviewApproval}
        onRunWrite={onRunWrite}
      />,
    );

    // Pending: only the approval-review button may appear -- never the
    // onRunReadOnly-wired "Run <toolId>" button, which would silently no-op.
    expect(pendingHtml).toContain("Review approval");
    expect(pendingHtml).not.toContain("Run github.issues.comment");

    // Approved: the run button must be present, wired to onRunWrite (it's the
    // only button rendered in this state), and labeled for this specific
    // tool -- not the complete_task-only "Complete task" label.
    expect(approvedHtml).toContain("Add a GitHub issue comment");
    expect(approvedHtml).not.toContain(">Complete task<");
    expect(approvedHtml).not.toContain("Run github.issues.comment");
  });

  it("formats supported runtime results through context synthesis and the response composer", () => {
    const message = resultMessage({
      requestId: "request-1",
      stepId: "step-1",
      toolId: "tasks.list",
      status: "success",
      success: true,
      memoryEvidenceRetained: false,
      safeSummary: "2 active tasks found.",
      safePreviewItems: ["Finish report", "Review calendar"],
      reasons: [],
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    }, "en", undefined, {
      primaryFact: "1 of your 2 open tasks is due today.",
      supportingFacts: ["1 open task does not have due dates."],
      safeSuggestion: "You may want to add due dates to those tasks.",
      evidenceDomains: ["tasks"],
      confidence: "medium",
      synthesisVersion: "context-synthesis-v1",
    });

    expect(message).toContain("Here is your task overview.");
    expect(message).toContain("1 of your 2 open tasks is due today.");
    expect(message).toContain("1 open task does not have due dates.");
    expect(message).toContain("- Finish report");
    expect(message).toContain("You may want to add due dates to those tasks.");
    expect(message).not.toContain("request-1");
  });

  it("localizes deterministic proposal messages to the resolved response language", () => {
    const german = reasoningResult("inspect_calendar");
    german.responseLanguage = "de";
    const farsi = reasoningResult("inspect_learning");
    farsi.responseLanguage = "fa";

    expect(proposalMessage(german)).toContain("Interpretierte Absicht");
    expect(proposalMessage(german)).toContain("Pruefe die vorgeschlagene Aktion");
    expect(proposalMessage(german)).not.toContain("Interpreted intent");
    expect(proposalMessage(farsi)).toContain("نیت تشخیص داده شد");
    expect(proposalMessage(farsi)).not.toContain("Interpreted intent");
  });

  it("localizes the same authoritative runtime summary for English, German, and Persian", () => {
    const emptyCalendar = {
      requestId: "request-calendar",
      stepId: "step-calendar",
      toolId: "calendar.list_today",
      status: "success" as const,
      success: true,
      memoryEvidenceRetained: false,
      safeSummary: "No events today.",
      safePreviewItems: [],
      reasons: [],
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    };

    expect(runtimeSummaryMessage(emptyCalendar, "en")).toBe("Your calendar is clear today.");
    expect(runtimeSummaryMessage(emptyCalendar, "de")).toBe("Dein Kalender ist heute frei.");
    expect(runtimeSummaryMessage(emptyCalendar, "fa")).toBe("تقویمت امروز خالی است.");
  });

  it("localizes completed, already-completed, and failed write summaries", () => {
    const writeResult = {
      requestId: "request-write",
      stepId: "step-write",
      toolId: "tasks.complete",
      status: "success" as const,
      success: true,
      verified: true,
      alreadyCompleted: false,
      memoryEvidenceRetained: false,
      safeSummary: "Task was marked complete.",
      reasons: [],
      startedAt: now,
      completedAt: now,
      durationMs: 0,
    };

    expect(runtimeSummaryMessage(writeResult, "de")).toBe("Die Aufgabe ist als erledigt markiert.");
    expect(runtimeSummaryMessage({
      ...writeResult,
      alreadyCompleted: true,
      safeSummary: "Task was already complete.",
    }, "fa")).toContain("قبلا انجام شده بود");
    expect(runtimeSummaryMessage({
      ...writeResult,
      status: "policy_denied",
      success: false,
      verified: false,
      safeSummary: "Write action was blocked.",
    }, "de")).toBe("Ich konnte die Aufgabenerledigung nicht sicher bestatigen.");
  });

  it("keeps Persian flow RTL while isolating independent English, German, and numeric blocks", () => {
    const mixed = renderToString(
      <ChatBubble
        role="assistant"
        language="fa"
        content={"این نتیجه برای Review active tasks است.\n\nReview active tasks (2).\n\nHeute sind 2 Termine frei."}
      />,
    );
    const english = renderToString(
      <ChatBubble role="assistant" language="en" content="Review active tasks (2)." />,
    );
    const german = renderToString(
      <ChatBubble role="assistant" language="de" content="Heute sind 2 Termine frei." />,
    );
    const farsi = renderToString(
      <ChatBubble role="assistant" language="fa" content="امروز ۲ کار فعال داری." />,
    );

    expect(mixed).toContain('dir="rtl"');
    expect(mixed.match(/dir="auto"/g)?.length).toBe(3);
    expect(mixed).toContain("Review active tasks (2).");
    expect(english).toContain('dir="ltr"');
    expect(german).toContain('dir="ltr"');
    expect(farsi).toContain('dir="rtl"');
    expect(farsi).toContain('dir="auto"');
  });

  it("isolates an English proposal inside Persian flow without mirroring proposal controls", () => {
    const proposalBubble = renderToString(
      <ChatBubble
        role="assistant"
        language="fa"
        content="Interpreted intent: Inspect tasks. Review the proposed action."
      />,
    );
    const farsiResult = reasoningResult("inspect_tasks");
    farsiResult.responseLanguage = "fa";
    const controls = renderToString(
      <ReasoningProposalCard
        proposal={{
          result: farsiResult,
          step: step("inspect_tasks"),
          resolution: resolution("tasks.list"),
          approval: null,
          runStatus: "idle",
        }}
        onRunReadOnly={vi.fn()}
        onReviewApproval={vi.fn()}
        onRunWrite={vi.fn()}
      />,
    );

    expect(proposalBubble).toContain('dir="rtl"');
    expect(proposalBubble).toContain('dir="auto"');
    expect(controls).toContain("Run tasks.list");
    expect(controls).not.toContain('dir="rtl"');
  });
});
