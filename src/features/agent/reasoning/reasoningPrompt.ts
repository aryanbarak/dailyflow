import { getAiResponseLanguageInstruction } from "@/features/ai/responseLanguage";
import type {
  AgentReasoningPromptInput,
  AgentReasoningSafeContext,
} from "./reasoningTypes";
import { writeIntentRegistry } from "../../../../shared/writeIntentRegistry";

const MAX_SAFE_ITEMS = 12;

// ADR-0013 Slice 5: the write-registry's own members of the "Supported
// intents"/"Allowed mappings" lines below, generated instead of hand-copied
// -- see buildReasoningPrompt's own comment at their call sites for the
// non-registry members that stay hand-written around them, in their
// original positions.
//
// Task 45c PART B (Ruling 2, PO): filtered to `exposure === 'chat'` --
// this is the REASONING view of the registry, a strict subset of the full
// (RUNTIME) registry. A `ui-only` entry (currently only
// import_bank_statement) must never appear in any of the three lines
// below; reasoningPrompt.test.ts's reverse guard asserts this directly
// against the rendered prompt text, not just against this filter's intent.
const CHAT_EXPOSED_REGISTRY_ENTRIES = writeIntentRegistry.filter((entry) => entry.exposure === 'chat');
const REGISTRY_SUPPORTED_INTENTS = CHAT_EXPOSED_REGISTRY_ENTRIES.map((entry) => entry.intentType).join(", ");
const REGISTRY_ALLOWED_MAPPINGS = CHAT_EXPOSED_REGISTRY_ENTRIES
  .map((entry) => `${entry.intentType}->${entry.toolId}`)
  .join(", ");
// Task 36b (Slice 0) backfilled promptInstruction on 3 of the 5 entries
// (calendar create/update, finance create) as data, not yet consumed by
// anything -- this is that consumption. create_task/update_task have none
// (no existing prompt prose to move verbatim) and are filtered out here so
// they contribute nothing, rather than an `undefined` entry that would
// render as a literal "undefined" line or leave a stray joiner.
const REGISTRY_PROMPT_INSTRUCTIONS = CHAT_EXPOSED_REGISTRY_ENTRIES
  .map((entry) => entry.promptInstruction)
  .filter((instruction): instruction is string => Boolean(instruction));

function safeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.slice(0, 160) : fallback;
}

function safeTasks(context: AgentReasoningSafeContext) {
  return context.tasks.slice(0, MAX_SAFE_ITEMS).map((task) => ({
    id: safeString(task.id),
    title: safeString(task.title, "Untitled task"),
    completed: task.completed === true || task.status === "completed",
    status: safeString(task.status),
    dueDate: safeString(task.dueDate),
  }));
}

function safeEvents(context: AgentReasoningSafeContext) {
  return context.events.slice(0, MAX_SAFE_ITEMS).map((event) => ({
    id: safeString(event.id),
    title: safeString(event.title, "Untitled event"),
    start: safeString(event.dateTimeStart ?? event.start),
  }));
}

function safeLearning(context: AgentReasoningSafeContext) {
  const progress = context.learningProgress;
  return {
    totalQuestions: progress?.totalQuestions,
    mode: safeString(progress?.mode),
    lessons: (progress?.lessons ?? []).slice(0, MAX_SAFE_ITEMS).map((lesson) => ({
      id: safeString(lesson.id),
      title: safeString(lesson.title, "Untitled lesson"),
      completionPercentage: lesson.completionPercentage,
      completed: lesson.completed === true,
    })),
  };
}

// "unknown" and "known with an empty list" are rendered as distinctly
// different JSON shapes on purpose -- see buildReasoningPrompt's inventory
// instruction line for why collapsing them would be a real behavior bug,
// not just a wording nitpick.
function safeGitHubInventory(context: AgentReasoningSafeContext) {
  const inventory = context.githubRepositoryInventory;
  if (!inventory || inventory.status === "unknown") {
    return { status: "unknown" as const };
  }
  return {
    status: "known" as const,
    names: inventory.names.slice(0, MAX_SAFE_ITEMS).map((name) => safeString(name)),
  };
}

function safeWorkspace(context: AgentReasoningSafeContext) {
  const workspace = context.workspace;
  if (!workspace) return null;
  return {
    goal: {
      title: safeString(workspace.goal.title),
      summary: safeString(workspace.goal.summary),
      primaryDomain: workspace.goal.primaryDomain,
    },
    plan: {
      title: safeString(workspace.plan.title),
      summary: safeString(workspace.plan.summary),
      stepCount: workspace.plan.steps.length,
    },
    signals: workspace.signalFeed.slice(0, MAX_SAFE_ITEMS).map((signal) => ({
      id: signal.id,
      domain: signal.domain,
      label: signal.label,
      severity: signal.severity,
      count: signal.count,
    })),
  };
}

export function buildReasoningPrompt(input: AgentReasoningPromptInput) {
  const safeContext = {
    tasks: safeTasks(input.safeContext),
    events: safeEvents(input.safeContext),
    learning: safeLearning(input.safeContext),
    workspace: safeWorkspace(input.safeContext),
    githubRepositoryInventory: safeGitHubInventory(input.safeContext),
  };

  return [
    "You are Flow AI's reasoning layer. Return JSON only.",
    "You propose one intent only. You never execute tools. You never approve actions.",
    "You never invent tool IDs. You never provide userId. You never claim actions completed before verified runtime success.",
    // ADR-0013 Slice 5: REGISTRY_SUPPORTED_INTENTS supplies exactly the
    // create_task, update_task, create_calendar_event, update_calendar_event,
    // create_finance_transaction segment, in registry order -- the same
    // position these five literals occupied by hand before this slice. Every
    // other member (read intents, complete_task, the two github write
    // intents, ask_clarification, unsupported) has no registry entry and
    // stays hand-written around it.
    `Supported intents: inspect_tasks, inspect_calendar, inspect_learning, inspect_workspace, inspect_github_repositories, inspect_github_issues, inspect_github_epics, inspect_github_pull_requests, inspect_github_workflow_runs, complete_task, ${REGISTRY_SUPPORTED_INTENTS}, write_github_issue_comment, write_github_issue_update, ask_clarification, unsupported.`,
    `Allowed mappings: inspect_tasks->tasks.list, inspect_calendar->calendar.list_today, inspect_learning->learning.get_progress, inspect_workspace->workspace.get_context, inspect_github_repositories->github.repositories.list, inspect_github_issues->github.issues.list, inspect_github_epics->github.epics.list, inspect_github_pull_requests->github.pulls.list, inspect_github_workflow_runs->github.workflow_runs.list, complete_task->tasks.complete, ${REGISTRY_ALLOWED_MAPPINGS}, write_github_issue_comment->github.issues.comment, write_github_issue_update->github.issues.update.`,
    "Domain distinction rules: task/task(s)/todo/unfinished/open tasks, Aufgabe/Aufgaben/offen/unerledigt/konzentrieren, and Persian task words like کارها or وظیفه indicate inspect_tasks.",
    "Calendar words like calendar/appointment/event/meeting, Kalender/Termin/Besprechung, and Persian تقویم/قرار/جلسه indicate inspect_calendar.",
    "The word today/heute/امروز alone never determines calendar intent. Use the strongest domain noun instead.",
    "GitHub repository requests in English, German, or Persian map only to inspect_github_repositories. This intent lists connected repository metadata only.",
    "GitHub issue requests in English, German, or Persian map only to inspect_github_issues. This intent lists open issue metadata only, never pull requests, issue bodies, or comments.",
    "GitHub epic / roadmap requests in English, German, or Persian map only to inspect_github_epics. This intent lists epic-labeled issue metadata only (repo, number, title, epic label, status label, url), never other labels, bodies, comments, or non-epic issues.",
    "GitHub pull request requests in English, German, or Persian map only to inspect_github_pull_requests. This intent lists open pull request metadata only, never issues, diffs, reviews, or comments.",
    "GitHub Actions / CI status requests in English, German, or Persian map only to inspect_github_workflow_runs. This intent lists recent workflow run status only, never logs, artifacts, or job details.",
    "Requests to add a comment to a GitHub issue map to write_github_issue_comment. Populate target.repo (owner/name), target.issueNumber, and target.commentBody with the exact comment text -- never invent any of these if the message does not state them explicitly.",
    "Requests to edit a GitHub issue's title, body, or labels map to write_github_issue_update. Populate target.repo, target.issueNumber, and at least one of target.updateTitle, target.updateBody, target.updateLabels -- never invent any of these if the message does not state them explicitly.",
    "write_github_issue_comment and write_github_issue_update require explicit user approval before anything runs -- you are proposing the action, not performing it. Never claim the comment was posted or the issue was updated.",
    // ADR-0013 Slice 5 / Slice 2B.1 LOCKED DOMAIN RULE: this is the
    // task-vs-calendar cross-domain disambiguation rule -- stays
    // hand-written per ADR-0013 (it reasons across both domains, not
    // per-intent data). The target-field instructions this sentence used
    // to also carry (Populate target.eventTitle.../target.eventReference...)
    // now come from the registry's promptInstruction, appended below.
    // CORRECTED (Slice 2B.1): the previous wording told the model to
    // silently reclassify a task-worded+timed request into
    // create_calendar_event "regardless of whether the user said 'task'"
    // -- the exact bug this slice fixes. An explicit domain noun now wins
    // before temporal inference; a task+time request is genuinely
    // ambiguous and must be asked about, never silently resolved either
    // way. src/features/agent/reasoning/intentValidator.ts's own
    // deterministic post-step (TASK_TIME_CLARIFICATION_REASON_MARKER)
    // enforces this regardless of what the model proposes, but only when
    // the model's own type is itself compatible with the regex-evidence
    // rescue -- a model that still complied with the OLD instruction and
    // proposed create_calendar_event directly would bypass that rescue
    // entirely, which is why this prompt text must match, not just the
    // code.
    "Tasks have no time-of-day field. A request that explicitly names a task (task/todo/Aufgabe/تسک/وظیفه) and ALSO carries a specific time (e.g. \"add a task tomorrow at 3pm\") is genuinely ambiguous: propose ask_clarification, asking whether to create it as a Task without the time or as a Calendar Event at that time. Never silently propose create_task/update_task with the time dropped, and never silently propose create_calendar_event/update_calendar_event just because a time was given -- the explicit domain word the user chose always wins over inferring a domain from a time alone. A request naming an explicit calendar concept (event, appointment, meeting, Termin, Kalender, رویداد, جلسه, قرار) is create_calendar_event/update_calendar_event, with or without a time. A plain date with no time and no calendar wording stays create_task/update_task, unchanged. Never invent a time -- if the request is genuinely unclear about whether it means a task or a calendar event, propose ask_clarification instead of guessing.",
    // ADR-0013 Slice 5: create_calendar_event's, update_calendar_event's, and
    // create_finance_transaction's own field-population/approval guidance,
    // sourced from the registry's promptInstruction instead of hand-written
    // here -- create_task/update_task have none and contribute nothing.
    ...REGISTRY_PROMPT_INSTRUCTIONS,
    "If a message names more than one of repositories, issues, epics, pull requests, workflow runs, issue comments, or issue updates, propose ask_clarification with candidates listing the specific ones it could mean, instead of guessing which one it means.",
    "When a message is genuinely ambiguous between 2 or 3 specific read-only intents -- for example a name in it matches a connected repository and could also mean something in a different domain, or it could mean either GitHub issues or pull requests -- set type to ask_clarification and also populate candidates with those 2 or 3 intents, each with its own short reasons. Only use candidates for genuine multi-way ambiguity between specific intents, never for missing information (which task, which repository) -- that stays a plain ask_clarification with clarificationQuestion and no candidates. Never include complete_task, write_github_issue_comment, or write_github_issue_update as a candidate -- candidates are read-only disambiguation only. Do not populate candidates when you have one confident answer.",
    "githubRepositoryInventory has two possible shapes. {\"status\":\"unknown\"} means the connected-repository list has not been loaded yet -- this does NOT mean the user has no GitHub repositories, so never use it as evidence against a GitHub intent; evaluate the message normally. {\"status\":\"known\",\"names\":[...]} lists the user's actually connected repository names (owner/repo). If the message names one of these, and that name could otherwise belong to a different domain (for example a learning topic with the same name), treat the match as evidence the message is about GitHub. A name appearing here never by itself selects which GitHub tool (repositories/issues/pull requests/workflow runs) to use -- that still follows the domain distinction rules above.",
    // ADR-0013 Slice 5: rewritten, not generated -- task 29 broke production
    // because this line was a SECOND, independently maintained enumeration
    // of what's excluded that silently drifted from the "Supported intents"
    // list above (finance shipped supported while this line still called
    // finance mutations unsupported). Now it explicitly refers back to that
    // one list instead of re-deriving its own; the concrete examples that
    // follow are not derivable from the registry (nothing supports them, so
    // they have no registry entry to generate from) and stay as prohibitions
    // the model needs spelled out, not a redefinition of "unsupported."
    "Any request that does not match one of the supported intents listed above is unsupported -- including deleting tasks or calendar events, sending messages, creating new GitHub issues, any file/code/pull-request operation, or arbitrary automation. The only supported GitHub writes are write_github_issue_comment and write_github_issue_update, both on an existing issue.",
    "Ask clarification when the target is ambiguous, when multiple tasks match, when no exact task is selected, when confidence is low, or when actions are mixed.",
    getAiResponseLanguageInstruction(input.responseLanguage),
    "Do not include task notes, document bodies, chat history, raw memory, audit history, policy internals, secrets, Supabase details, or userId.",
    "Output schema fields: id,type,confidence,userMessage,target,requestedDomain,toolId,requiresTool,requiresApproval,clarificationQuestion,reasons,candidates,language,generatedAt,schemaVersion.",
    `Current safe context JSON: ${JSON.stringify(safeContext)}`,
    `User message: ${input.userMessage}`,
  ].join("\n");
}
