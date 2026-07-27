import { getAiResponseLanguageInstruction } from "@/features/ai/responseLanguage";
import type {
  AgentReasoningPromptInput,
  AgentReasoningSafeContext,
} from "./reasoningTypes";

const MAX_SAFE_ITEMS = 12;

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
    "Supported intents: inspect_tasks, inspect_calendar, inspect_learning, inspect_workspace, inspect_github_repositories, inspect_github_issues, inspect_github_epics, inspect_github_pull_requests, inspect_github_workflow_runs, complete_task, ask_clarification, unsupported.",
    "Allowed mappings: inspect_tasks->tasks.list, inspect_calendar->calendar.list_today, inspect_learning->learning.get_progress, inspect_workspace->workspace.get_context, inspect_github_repositories->github.repositories.list, inspect_github_issues->github.issues.list, inspect_github_epics->github.epics.list, inspect_github_pull_requests->github.pulls.list, inspect_github_workflow_runs->github.workflow_runs.list, complete_task->tasks.complete.",
    "Domain distinction rules: task/task(s)/todo/unfinished/open tasks, Aufgabe/Aufgaben/offen/unerledigt/konzentrieren, and Persian task words like کارها or وظیفه indicate inspect_tasks.",
    "Calendar words like calendar/appointment/event/meeting, Kalender/Termin/Besprechung, and Persian تقویم/قرار/جلسه indicate inspect_calendar.",
    "The word today/heute/امروز alone never determines calendar intent. Use the strongest domain noun instead.",
    "GitHub repository requests in English, German, or Persian map only to inspect_github_repositories. This intent lists connected repository metadata only.",
    "GitHub issue requests in English, German, or Persian map only to inspect_github_issues. This intent lists open issue metadata only, never pull requests, issue bodies, or comments.",
    "GitHub epic / roadmap requests in English, German, or Persian map only to inspect_github_epics. This intent lists epic-labeled issue metadata only (repo, number, title, epic label, status label, url), never other labels, bodies, comments, or non-epic issues.",
    "GitHub pull request requests in English, German, or Persian map only to inspect_github_pull_requests. This intent lists open pull request metadata only, never issues, diffs, reviews, or comments.",
    "GitHub Actions / CI status requests in English, German, or Persian map only to inspect_github_workflow_runs. This intent lists recent workflow run status only, never logs, artifacts, or job details.",
    "If a message names more than one of repositories, issues, epics, pull requests, or workflow runs, propose ask_clarification with candidates listing the specific ones it could mean, instead of guessing which one it means.",
    "When a message is genuinely ambiguous between 2 or 3 specific read-only intents -- for example a name in it matches a connected repository and could also mean something in a different domain, or it could mean either GitHub issues or pull requests -- set type to ask_clarification and also populate candidates with those 2 or 3 intents, each with its own short reasons. Only use candidates for genuine multi-way ambiguity between specific intents, never for missing information (which task, which repository) -- that stays a plain ask_clarification with clarificationQuestion and no candidates. Never include complete_task as a candidate. Do not populate candidates when you have one confident answer.",
    "githubRepositoryInventory has two possible shapes. {\"status\":\"unknown\"} means the connected-repository list has not been loaded yet -- this does NOT mean the user has no GitHub repositories, so never use it as evidence against a GitHub intent; evaluate the message normally. {\"status\":\"known\",\"names\":[...]} lists the user's actually connected repository names (owner/repo). If the message names one of these, and that name could otherwise belong to a different domain (for example a learning topic with the same name), treat the match as evidence the message is about GitHub. A name appearing here never by itself selects which GitHub tool (repositories/issues/pull requests/workflow runs) to use -- that still follows the domain distinction rules above.",
    "Unsupported requests include create/update/delete tasks, send messages, create events, finance mutations, or arbitrary automation.",
    "Ask clarification when the target is ambiguous, when multiple tasks match, when no exact task is selected, when confidence is low, or when actions are mixed.",
    getAiResponseLanguageInstruction(input.responseLanguage),
    "Do not include task notes, document bodies, chat history, raw memory, audit history, policy internals, secrets, Supabase details, or userId.",
    "Output schema fields: id,type,confidence,userMessage,target,requestedDomain,toolId,requiresTool,requiresApproval,clarificationQuestion,reasons,candidates,language,generatedAt,schemaVersion.",
    `Current safe context JSON: ${JSON.stringify(safeContext)}`,
    `User message: ${input.userMessage}`,
  ].join("\n");
}
