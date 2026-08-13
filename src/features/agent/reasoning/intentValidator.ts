import type { SupportedAiResponseLanguage } from "@/features/ai/responseLanguage";
import {
  AGENT_INTENT_SCHEMA_VERSION,
  type AgentIntentConfidence,
  type AgentIntentDomain,
  type AgentIntentProposal,
  type AgentIntentType,
  type AgentReasoningSafeContext,
  type AgentReasoningValidationResult,
} from "./reasoningTypes";

export const supportedIntentTypes: AgentIntentType[] = [
  "inspect_tasks",
  "inspect_calendar",
  "inspect_learning",
  "inspect_workspace",
  "inspect_github_repositories",
  "inspect_github_issues",
  "inspect_github_epics",
  "inspect_github_pull_requests",
  "inspect_github_workflow_runs",
  "complete_task",
  "create_task",
  "update_task",
  "write_github_issue_comment",
  "write_github_issue_update",
  "ask_clarification",
  "unsupported",
];

// EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
// Every intent here already reaches requiresApproval + the approval dialog
// before anything executes. Shared by: the requestLooksUnsupported gate
// (a write intent's own natural language, e.g. "add a comment", must not be
// rejected by the generic create/update/add blocklist below), the mixed-
// request gate (an already-resolved write intent is exempt from being
// second-guessed by a read verb elsewhere in the same message), and the
// final requiresApproval assignment.
const CONFIRMED_WRITE_INTENT_TYPES = new Set<AgentIntentType>([
  "complete_task",
  "create_task",
  "update_task",
  "write_github_issue_comment",
  "write_github_issue_update",
]);

const supportedDomains: AgentIntentDomain[] = [
  "tasks",
  "calendar",
  "learning",
  "workspace",
  "github",
];

const supportedConfidence: AgentIntentConfidence[] = ["low", "medium", "high"];

const intentToolMap = {
  inspect_tasks: "tasks.list",
  inspect_calendar: "calendar.list_today",
  inspect_learning: "learning.get_progress",
  inspect_workspace: "workspace.get_context",
  inspect_github_repositories: "github.repositories.list",
  inspect_github_issues: "github.issues.list",
  inspect_github_epics: "github.epics.list",
  inspect_github_pull_requests: "github.pulls.list",
  inspect_github_workflow_runs: "github.workflow_runs.list",
  complete_task: "tasks.complete",
  create_task: "tasks.create",
  update_task: "tasks.update",
  write_github_issue_comment: "github.issues.comment",
  write_github_issue_update: "github.issues.update",
} as const;

type KnownToolId = typeof intentToolMap[keyof typeof intentToolMap];

const domainByIntent: Partial<Record<AgentIntentType, AgentIntentDomain>> = {
  inspect_tasks: "tasks",
  inspect_calendar: "calendar",
  inspect_learning: "learning",
  inspect_workspace: "workspace",
  inspect_github_repositories: "github",
  inspect_github_issues: "github",
  inspect_github_epics: "github",
  inspect_github_pull_requests: "github",
  inspect_github_workflow_runs: "github",
  complete_task: "tasks",
  create_task: "tasks",
  update_task: "tasks",
  write_github_issue_comment: "github",
  write_github_issue_update: "github",
};

function textFor(language: SupportedAiResponseLanguage, key: "clarify" | "unsupported" | "low") {
  const copy = {
    en: {
      clarify: "Which exact item should I use?",
      unsupported: "I can't safely do that yet.",
      low: "Can you clarify what you want me to inspect or prepare?",
    },
    de: {
      clarify: "Welches genaue Element soll ich verwenden?",
      unsupported: "Das kann ich noch nicht sicher ausführen.",
      low: "Kannst du genauer sagen, was ich prüfen oder vorbereiten soll?",
    },
    fa: {
      clarify: "دقیقاً کدام مورد را باید استفاده کنم؟",
      unsupported: "فعلاً نمی‌توانم این کار را به‌صورت امن انجام بدهم.",
      low: "می‌توانید دقیق‌تر بگویید چه چیزی را بررسی یا آماده کنم؟",
    },
  } as const;
  return copy[language][key];
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

function safeReasons(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 4);
}

function createSafeProposal(
  type: "ask_clarification" | "unsupported",
  input: {
    userMessage: string;
    language: SupportedAiResponseLanguage;
    now: Date;
    question?: string;
    reason: string;
  },
): AgentReasoningValidationResult {
  const proposal: AgentIntentProposal = {
    id: `intent:${type}:${input.now.toISOString()}`,
    type,
    confidence: "medium",
    userMessage: input.userMessage,
    requestedDomain: undefined,
    requiresTool: false,
    requiresApproval: false,
    clarificationQuestion:
      input.question ?? textFor(input.language, type === "unsupported" ? "unsupported" : "clarify"),
    reasons: [input.reason],
    language: input.language,
    generatedAt: input.now.toISOString(),
    schemaVersion: AGENT_INTENT_SCHEMA_VERSION,
  };
  return { proposal, validationReasons: [input.reason] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasRejectedFields(value: Record<string, unknown>) {
  return (
    "userId" in value ||
    "user_id" in value ||
    "actions" in value ||
    "extraActions" in value ||
    "toolIds" in value ||
    "code" in value
  );
}

// EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
// Deliberately stricter than the task fields above: there is no safe-context
// list of the user's own GitHub issues to fuzzy-match against, so repo,
// issueNumber, and body-like fields are either well-formed or dropped
// entirely (undefined) -- never partially trusted or guessed.
function safeRepoIdentifier(value: unknown) {
  const raw = safeString(value);
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(raw) ? raw : undefined;
}

function safePositiveInteger(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(num) && num > 0 ? num : undefined;
}

function safeBoundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || undefined;
}

function safeLabelList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const labels = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 20);
  return labels.length > 0 ? labels : undefined;
}

function normalizeTarget(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    taskId: safeString(value.taskId) || undefined,
    taskReference: safeString(value.taskReference) || undefined,
    taskTitleHint: safeString(value.taskTitleHint) || undefined,
    title: safeBoundedText(value.title, 200),
    notes: safeBoundedText(value.notes, 2000),
    dueDate: value.dueDate === null ? null : safeBoundedText(value.dueDate, 32),
    repo: safeRepoIdentifier(value.repo),
    issueNumber: safePositiveInteger(value.issueNumber),
    commentBody: safeBoundedText(value.commentBody, 10_000),
    updateTitle: safeBoundedText(value.updateTitle, 200),
    updateBody: safeBoundedText(value.updateBody, 10_000),
    updateLabels: safeLabelList(value.updateLabels),
  };
}

function findGithubIssueCommentTarget(target: ReturnType<typeof normalizeTarget>) {
  if (!target?.repo || !target.issueNumber || !target.commentBody) {
    return { status: "missing" as const };
  }
  return { status: "matched" as const };
}

function findGithubIssueUpdateTarget(target: ReturnType<typeof normalizeTarget>) {
  if (!target?.repo || !target.issueNumber) {
    return { status: "missing" as const };
  }
  if (!target.updateTitle && !target.updateBody && !target.updateLabels) {
    return { status: "missing" as const };
  }
  return { status: "matched" as const };
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function findTaskTarget(
  context: AgentReasoningSafeContext,
  target: ReturnType<typeof normalizeTarget>,
) {
  const tasks = context.tasks;
  if (!target) return { status: "missing" as const };

  if (target.taskId) {
    const task = tasks.find((item) => item.id === target.taskId);
    return task ? { status: "matched" as const, task } : { status: "missing" as const };
  }

  const reference = normalizeTitle(target.taskReference ?? target.taskTitleHint ?? "");
  if (!reference) return { status: "missing" as const };
  const matches = tasks.filter((task) => {
    const title = normalizeTitle(task.title ?? "");
    return title === reference || title.includes(reference) || reference.includes(title);
  });
  if (matches.length === 1) return { status: "matched" as const, task: matches[0] };
  if (matches.length > 1) return { status: "ambiguous" as const };
  return { status: "missing" as const };
}

function requestLooksLikeTaskCompletion(message: string) {
  if (
    /\b(abschlie\u00dfen|erledigt)\b/i.test(message) ||
    /(\u06a9\u0627\u0645\u0644\s+\u06a9\u0646|\u062a\u06a9\u0645\u06cc\u0644\s+\u06a9\u0646|\u062a\u0645\u0627\u0645\s+\u06a9\u0646|\u0627\u0646\u062c\u0627\u0645[\u200c\s-]?\u0634\u062f\u0647|\u0639\u0644\u0627\u0645\u062a\s+\u0628\u0632\u0646)/i.test(message)
  ) {
    return true;
  }
  return /\b(complete|finish|mark .* done|mark .* complete|done|erledige|abschliessen|abschließen|markiere|کامل کن|تمام کن|انجام‌شده)\b/i.test(message);
}

function requestLooksLikeTaskCreate(message: string) {
  return /\b(create|add|set up|erstelle|hinzuf[üu]gen)\b.{0,40}\b(task|todo|aufgabe)\b/i.test(message) ||
    /(\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631).{0,40}(\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/i.test(message);
}

function requestLooksLikeTaskUpdate(message: string) {
  return /\b(update|edit|change|move|reschedule|aktualisiere|bearbeite|verschiebe)\b.{0,50}\b(task|todo|aufgabe)\b/i.test(message) ||
    /(\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631).{0,50}(\u0628\u0647[\u200c\s-]?\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc\s+\u06a9\u0646|\u0648\u06cc\u0631\u0627\u06cc\u0634\s+\u06a9\u0646|\u062a\u063a\u06cc\u06cc\u0631\s+\u0628\u062f\u0647)/i.test(message);
}

// EPIC-07 (Write Light) -- see docs/adr/ADR-0004-write-boundaries.md.
// "comment" alone is deliberately excluded -- it collides with read-ish
// phrasing like "any comments on my code style", the same class of risk as
// the excluded bare "PR" and bare "plan" elsewhere in this file. Only the
// verb-shaped phrases count as evidence.
function requestLooksLikeGithubIssueComment(message: string) {
  return (
    /\b(add (a |the )?comment|post (a |the )?comment|comment on (this|the|an?|my) issue|reply to (this|the|an?|my) issue)\b/i.test(message) ||
    /(کامنت( بگذار| بذار| اضافه کن)?|نظر بده|پاسخ بده)/i.test(message)
  );
}

// "update"/"edit" alone are excluded for the same reason -- these phrases
// are compound (matches the literal spec: "update issue", "edit issue",
// "change label"), never bare.
function requestLooksLikeGithubIssueUpdate(message: string) {
  return (
    /\b(update (this |the |an?|my )?issue|edit (this |the |an?|my )?issue|change (the |a )?label)\b/i.test(message) ||
    /(آپدیت( کن)? ایشو|ایشو( را| رو)? آپدیت کن|لیبل( را| رو)? تغییر بده|تغییر لیبل)/i.test(message)
  );
}

function requestReferencesSelectedTask(message: string) {
  if (
    /\bausgew[a\u00e4]hlte[nr]?\s+aufgabe\b/i.test(message) ||
    /(\u0648\u0638\u06cc\u0641\u0647|\u06a9\u0627\u0631)\s+\u0627\u0646\u062a\u062e\u0627\u0628[\u200c\s-]?\u0634\u062f\u0647/i.test(message)
  ) {
    return true;
  }
  return /\b(selected|this|that|the)\s+task\b/i.test(message);
}

function deriveTaskCompletionTarget(
  context: AgentReasoningSafeContext,
  target: ReturnType<typeof normalizeTarget>,
  message: string,
): ReturnType<typeof normalizeTarget> {
  if (target?.taskId || target?.taskReference || target?.taskTitleHint) return target;
  if (!requestReferencesSelectedTask(message)) return target;
  if (context.tasks.length !== 1) return target;

  const [task] = context.tasks;
  if (!task?.id) return target;
  return {
    ...target,
    taskId: task.id,
    taskReference: undefined,
    taskTitleHint: task.title,
  };
}

function requestLooksUnsupported(message: string) {
  return (
    /\b(create|update|delete|send|pay|share|invite|add|remove|move|reschedule)\b/i.test(message) ||
    /\b(erstelle|loesche|lösche|verschiebe|sende|bezahle|teile|entferne|hinzufuegen|hinzufügen)\b/i.test(message) ||
    /(بساز|ایجاد کن|حذف کن|منتقل کن|بفرست|ارسال کن|دعوت کن|اضافه کن|پاک کن)/i.test(message)
  );
}

function requestLooksMixed(message: string, type: AgentIntentType) {
  if (CONFIRMED_WRITE_INTENT_TYPES.has(type)) return false;
  const hasReadIntent =
    /\b(check|show|inspect|list|summarize|continue|what|which|zeig|zeige|pruefe|prüfe|fasse|setze|نشان بده|بررسی کن|خلاصه کن|ادامه بده)\b/i.test(message);
  const hasWriteIntent =
    requestLooksLikeTaskCompletion(message) ||
    requestLooksLikeGithubIssueComment(message) ||
    requestLooksLikeGithubIssueUpdate(message);
  return hasReadIntent && hasWriteIntent;
}

function messageHasAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

const GITHUB_REPOSITORIES_EVIDENCE_PATTERNS = [
  /\b(github repositories|github repos|connected repositories|connected repos|github repository)\b/i,
  /\b(github-repositories|verbundene repositories|github-repos)\b/i,
  /((گیت[‌\s-]?هاب|github).*(مخزن|مخزن[‌\s-]?ها)|(مخزن|مخزن[‌\s-]?ها).*(گیت[‌\s-]?هاب|github))/i,
];

const GITHUB_ISSUES_EVIDENCE_PATTERNS = [
  /\b(github issues|open issues|connected issues|github issue)\b/i,
  /\b(github-issues|offene issues|offenen issues)\b/i,
  /((گیت[‌\s-]?هاب|github).*(ایشو|ایشوها|مسئله|مسائل)|(ایشو|ایشوها|مسئله|مسائل).*(گیت[‌\s-]?هاب|github))/i,
];

// Bare "plan" is deliberately excluded — it collides with the workspace
// domain's "current plan" evidence (see getStrongReadDomainEvidence) and
// would turn "what's my current plan" into a false conflicting-domain
// clarification. Only the more specific "project plan" phrasing counts,
// same rationale as excluding bare "PR" below.
const GITHUB_EPICS_EVIDENCE_PATTERNS = [
  /\b(roadmap|epics?|project plan)\b/i,
  /\b(road-?map|epics?)\b/i,
  /(نقشه[‌\s-]?راه|اپیک|اپیک[‌\s-]?ها|برنامه[‌\s-]?پروژه|مپ)/i,
];

// Bare "PR"/"PRs" is deliberately excluded — it's an ambiguous initialism, a
// real collision risk. Only the spelled-out phrase counts as evidence; this
// is a rescue backstop, not the only path, so Gemini's own schema-enforced
// choice still covers "show my open PRs" when the type comes back well-formed.
const GITHUB_PULL_REQUESTS_EVIDENCE_PATTERNS = [
  /\b(pull requests?|open pull requests?|github pull requests?|connected pull requests?)\b/i,
  /\b(pull-requests?|offene pull requests?|verbundene pull requests?)\b/i,
  /((گیت[‌\s-]?هاب|github).*(پول[‌\s-]?ریکوئست|پول[‌\s-]?ریکوئست[‌\s-]?ها|درخواست[‌\s-]?ادغام)|(پول[‌\s-]?ریکوئست|پول[‌\s-]?ریکوئست[‌\s-]?ها|درخواست[‌\s-]?ادغام).*(گیت[‌\s-]?هاب|github))/i,
];

const GITHUB_WORKFLOW_RUNS_EVIDENCE_PATTERNS = [
  /\b(workflow runs?|github actions?|ci status|build status|pipeline status|action runs?)\b/i,
  /\b(workflow-runs?|ci-status|pipeline-status)\b/i,
  /((گیت[‌\s-]?هاب|github).*(ورک[‌\s-]?فلو|اکشن|اکشن[‌\s-]?ها|وضعیت[‌\s-]?سی[‌\s-]?آی)|(ورک[‌\s-]?فلو|اکشن|اکشن[‌\s-]?ها|وضعیت[‌\s-]?سی[‌\s-]?آی).*(گیت[‌\s-]?هاب|github))/i,
];

// One or more tools can share a domain (e.g. github: repositories, issues).
// Domain-level evidence (getStrongReadDomainEvidence) only proves "this
// message is about <domain>" — picking which of that domain's tools to
// rescue into needs a finer check. This table drives that check for every
// domain uniformly: add a tool's evidence patterns here and it's covered,
// no new disambiguation function needed. A message matching more than one
// tool in the same domain is genuinely ambiguous, not a signal to guess.
type ReadToolIntentType = Exclude<AgentIntentType, "complete_task" | "create_task" | "update_task" | "write_github_issue_comment" | "write_github_issue_update" | "ask_clarification" | "unsupported">;

const TOOL_EVIDENCE_PATTERNS: Partial<Record<ReadToolIntentType, RegExp[]>> = {
  inspect_github_repositories: GITHUB_REPOSITORIES_EVIDENCE_PATTERNS,
  inspect_github_issues: GITHUB_ISSUES_EVIDENCE_PATTERNS,
  inspect_github_epics: GITHUB_EPICS_EVIDENCE_PATTERNS,
  inspect_github_pull_requests: GITHUB_PULL_REQUESTS_EVIDENCE_PATTERNS,
  inspect_github_workflow_runs: GITHUB_WORKFLOW_RUNS_EVIDENCE_PATTERNS,
};

function getToolEvidenceForDomain(
  domain: AgentIntentDomain,
  message: string,
): ReadToolIntentType | "conflicting" | null {
  const candidates = (Object.keys(TOOL_EVIDENCE_PATTERNS) as ReadToolIntentType[]).filter(
    (intentType) => domainByIntent[intentType] === domain,
  );
  const matched = candidates.filter((intentType) =>
    messageHasAny(message, TOOL_EVIDENCE_PATTERNS[intentType] ?? []),
  );
  if (matched.length > 1) return "conflicting";
  return matched.length === 1 ? matched[0] : null;
}

// German bare "offen"/"offene"/"offenen" ("open") is not task-specific on
// its own -- "Ist die Bibliothek offen?" ("Is the library open?") has
// nothing to do with tasks. It only counts as task evidence when it
// co-occurs with an explicit task/issue/PR noun nearby (either order,
// ~30 chars), e.g. "offene Aufgaben" / "Aufgaben ... offen". Conversation
// Quality v1 (task 9) fix -- previously a standalone word in the list
// below, which false-positived on every unrelated "offen".
const GERMAN_OFFEN_WITH_TASK_CONTEXT =
  /\boffene?n?\b.{0,30}\b(aufgabe|aufgaben|issue|issues|pr|pull request)\b|\b(aufgabe|aufgaben|issue|issues|pr|pull request)\b.{0,30}\boffene?n?\b/i;

export function getStrongReadDomainEvidence(message: string): AgentIntentDomain | "conflicting" | null {
  const taskEvidence = messageHasAny(message, [
    /\b(task|tasks|open tasks|unfinished|to-?do|todos|focus on)\b/i,
    /\b(aufgabe|aufgaben|unerledigt|nicht erledigt|fokus|konzentrieren)\b/i,
    /(\u0648\u0638\u06cc\u0641\u0647|\u0648\u0638\u0627\u06cc\u0641|\u06a9\u0627\u0631\u0647\u0627|\u06a9\u0627\u0631\u0647\u0627\u06cc|\u062a\u0645\u0631\u06a9\u0632|\u062a\u0645\u0627\u0645 \u0646\u0634\u062f\u0647|\u0627\u0646\u062c\u0627\u0645 \u0646\u0634\u062f\u0647)/i,
  ]) || GERMAN_OFFEN_WITH_TASK_CONTEXT.test(message);
  const calendarEvidence = messageHasAny(message, [
    /\b(calendar|appointment|appointments|event|events|meeting|meetings|schedule)\b/i,
    /\b(kalender|termin|termine|besprechung|besprechungen|meeting|meetings)\b/i,
    /(\u062a\u0642\u0648\u06cc\u0645|\u0642\u0631\u0627\u0631|\u0642\u0631\u0627\u0631\u0647\u0627|\u062c\u0644\u0633\u0647|\u062c\u0644\u0633\u0627\u062a)/i,
  ]);
  const learningEvidence = messageHasAny(message, [
    /\b(learn|learning|lesson|lessons|study|studying)\b/i,
    /\b(lernen|lerne|lernfortschritt|n\u00e4chstes lernen|naechstes lernen)\b/i,
    /(\u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc|\u062f\u0631\u0633|\u0622\u0645\u0648\u0632\u0634|\u06cc\u0627\u062f \u0628\u06af\u06cc\u0631)/i,
  ]);
  const workspaceEvidence = messageHasAny(message, [
    /\b(workspace|current plan|summarize my workspace)\b/i,
    /\b(workspace|aktueller plan|arbeitsbereich)\b/i,
    /(\u0628\u0631\u0646\u0627\u0645\u0647 \u0641\u0639\u0644\u06cc|workspace)/i,
  ]);
  const githubEvidence = getToolEvidenceForDomain("github", message) !== null;

  const matches = [
    taskEvidence ? "tasks" : null,
    calendarEvidence ? "calendar" : null,
    learningEvidence ? "learning" : null,
    workspaceEvidence ? "workspace" : null,
    githubEvidence ? "github" : null,
  ].filter((domain): domain is AgentIntentDomain => domain !== null);

  const uniqueMatches = Array.from(new Set(matches));
  if (uniqueMatches.length === 0) return null;
  if (uniqueMatches.length > 1) return "conflicting";
  return uniqueMatches[0];
}

function normalizeReadIntentFromEvidence(
  type: AgentIntentType,
  domainEvidence: AgentIntentDomain | "conflicting" | null,
  message: string,
): AgentIntentType {
  if (!domainEvidence || domainEvidence === "conflicting" || CONFIRMED_WRITE_INTENT_TYPES.has(type) || type === "unsupported") {
    return type;
  }
  if (
    type === "ask_clarification" ||
    type === "inspect_tasks" ||
    type === "inspect_calendar" ||
    type === "inspect_learning" ||
    type === "inspect_workspace" ||
    type === "inspect_github_repositories" ||
    type === "inspect_github_issues" ||
    type === "inspect_github_epics" ||
    type === "inspect_github_pull_requests" ||
    type === "inspect_github_workflow_runs"
  ) {
    if (domainEvidence === "tasks") return "inspect_tasks";
    if (domainEvidence === "calendar") return "inspect_calendar";
    if (domainEvidence === "learning") return "inspect_learning";
    if (domainEvidence === "workspace") return "inspect_workspace";
    if (domainEvidence === "github") {
      // Domain-level evidence only proves "this is about github" — which
      // specific tool needs the finer, table-driven check above. A message
      // matching more than one of the domain's tools is left unrescued
      // rather than guessed.
      const toolIntent = getToolEvidenceForDomain("github", message);
      return toolIntent && toolIntent !== "conflicting" ? toolIntent : type;
    }
  }
  return type;
}

export function validateAgentIntentProposal(input: {
  rawProposal: unknown;
  userMessage: string;
  safeContext: AgentReasoningSafeContext;
  language: SupportedAiResponseLanguage;
  now?: Date;
}): AgentReasoningValidationResult {
  const now = input.now ?? new Date();
  if (!isRecord(input.rawProposal)) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "low"),
      reason: "LLM output was not a valid object.",
    });
  }

  if (hasRejectedFields(input.rawProposal)) {
    return createSafeProposal("unsupported", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      reason: "LLM output contained unsupported security-relevant fields.",
    });
  }

  const initialType = safeString(input.rawProposal.type) as AgentIntentType;
  const initialTypeSupported = supportedIntentTypes.includes(initialType);
  const domainEvidence = getStrongReadDomainEvidence(input.userMessage);
  const completionRequested = requestLooksLikeTaskCompletion(input.userMessage);
  const taskCreateRequested = requestLooksLikeTaskCreate(input.userMessage);
  const taskUpdateRequested = requestLooksLikeTaskUpdate(input.userMessage);
  // EPIC-07 (Write Light): same rescue shape as complete_task above it --
  // detected from the message independently of whatever the LLM proposed,
  // and only ever assigned when the message isn't also mixed with a read
  // verb or simultaneously matching the *other* write-intent's evidence
  // (a message naming both is genuinely ambiguous, not a guess to make).
  const commentRequested = requestLooksLikeGithubIssueComment(input.userMessage);
  const issueUpdateRequested = requestLooksLikeGithubIssueUpdate(input.userMessage);
  const writeRequestCount = [commentRequested, issueUpdateRequested, taskCreateRequested, taskUpdateRequested, completionRequested]
    .filter(Boolean).length;
  const conflictingWriteRequest = writeRequestCount > 1;
  const mixedReadWriteRequest = requestLooksMixed(input.userMessage, "inspect_tasks");
  // An unrecognized type is treated the same as a total parse failure (fallbackRawProposal
  // also starts from "ask_clarification"): fall through to deterministic evidence-based
  // normalization instead of rejecting immediately. The rescued type still comes only from
  // regex evidence over the user's own message, never from whatever the LLM proposed.
  const normalizationSourceType = initialTypeSupported ? initialType : "ask_clarification";
  const type = completionRequested &&
    !mixedReadWriteRequest &&
    (normalizationSourceType === "ask_clarification" || normalizationSourceType === "inspect_tasks" || normalizationSourceType === "complete_task")
    ? "complete_task"
    : taskCreateRequested &&
      !conflictingWriteRequest &&
      !mixedReadWriteRequest &&
      (normalizationSourceType === "ask_clarification" || normalizationSourceType === "inspect_tasks" || normalizationSourceType === "create_task")
      ? "create_task"
      : taskUpdateRequested &&
        !conflictingWriteRequest &&
        !mixedReadWriteRequest &&
        (normalizationSourceType === "ask_clarification" || normalizationSourceType === "inspect_tasks" || normalizationSourceType === "update_task")
        ? "update_task"
    : commentRequested &&
      !conflictingWriteRequest &&
      !mixedReadWriteRequest &&
      (normalizationSourceType === "ask_clarification" || normalizationSourceType === "inspect_github_issues" || normalizationSourceType === "write_github_issue_comment")
      ? "write_github_issue_comment"
      : issueUpdateRequested &&
        !conflictingWriteRequest &&
        !mixedReadWriteRequest &&
        (normalizationSourceType === "ask_clarification" || normalizationSourceType === "inspect_github_issues" || normalizationSourceType === "write_github_issue_update")
        ? "write_github_issue_update"
        : normalizeReadIntentFromEvidence(normalizationSourceType, domainEvidence, input.userMessage);
  const normalizedByEvidence = type !== initialType;
  if (!initialTypeSupported && type === "ask_clarification") {
    return createSafeProposal("unsupported", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      reason: "Unknown intent type was rejected.",
    });
  }
  if (!supportedIntentTypes.includes(type)) {
    return createSafeProposal("unsupported", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      reason: "Unknown intent type was rejected.",
    });
  }

  // A numeric or otherwise unrecognized confidence value (e.g. Gemini sending 0.9 instead of
  // "high") is not evidence of low confidence — it's an unusable value, same class of problem
  // as an unrecognized type. Treat it like a safe default so it doesn't discard an already-
  // correct evidence-rescued type. Only an explicit "low" from the model still requires
  // clarification.
  const proposedConfidence = safeString(input.rawProposal.confidence) as AgentIntentConfidence;
  const confidence: AgentIntentConfidence = proposedConfidence === "low"
    ? "low"
    : supportedConfidence.includes(proposedConfidence)
      ? proposedConfidence
      : "medium";
  if (confidence === "low") {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "low"),
      reason: "Low confidence requires clarification.",
    });
  }

  if (
    type === "unsupported" ||
    (requestLooksUnsupported(input.userMessage) && !CONFIRMED_WRITE_INTENT_TYPES.has(type))
  ) {
    return createSafeProposal("unsupported", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: safeString(input.rawProposal.clarificationQuestion) || textFor(input.language, "unsupported"),
      reason: "Unsupported action was rejected.",
    });
  }

  if (domainEvidence === "conflicting") {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Conflicting strong domain evidence requires clarification.",
    });
  }

  if (type === "ask_clarification") {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: safeString(input.rawProposal.clarificationQuestion) || textFor(input.language, "clarify"),
      reason: "Clarification requested.",
    });
  }

  if (requestLooksMixed(input.userMessage, type)) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Mixed read/write request requires clarification before any action.",
    });
  }

  const expectedToolId = intentToolMap[type as keyof typeof intentToolMap];
  const proposedToolId = safeString(input.rawProposal.toolId);
  if (proposedToolId && proposedToolId !== expectedToolId && !normalizedByEvidence) {
    return createSafeProposal("unsupported", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      reason: "Invented or mismatched tool id was rejected.",
    });
  }

  const expectedDomain = domainByIntent[type];
  const proposedDomain = safeString(input.rawProposal.requestedDomain) as AgentIntentDomain;
  if (proposedDomain && !supportedDomains.includes(proposedDomain) && !normalizedByEvidence) {
    return createSafeProposal("unsupported", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      reason: "Unsupported domain was rejected.",
    });
  }
  if (proposedDomain && expectedDomain && proposedDomain !== expectedDomain && !normalizedByEvidence) {
    return createSafeProposal("unsupported", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      reason: "Intent domain did not match the supported tool mapping.",
    });
  }

  const target = type === "complete_task"
    ? deriveTaskCompletionTarget(input.safeContext, normalizeTarget(input.rawProposal.target), input.userMessage)
    : normalizeTarget(input.rawProposal.target);
  if (type === "complete_task") {
    const match = findTaskTarget(input.safeContext, target);
    if (match.status !== "matched" || !match.task.id) {
      return createSafeProposal("ask_clarification", {
        userMessage: input.userMessage,
        language: input.language,
        now,
        question: textFor(input.language, "clarify"),
        reason: match.status === "ambiguous"
          ? "Multiple matching tasks require clarification."
          : "Exact task target is required before approval.",
      });
    }
    target!.taskId = match.task.id;
    target!.taskTitleHint = match.task.title;
  }
  if (type === "create_task" && !target?.title) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Task title is required before creating a task.",
    });
  }
  if (type === "update_task") {
    const match = findTaskTarget(input.safeContext, target);
    if (match.status !== "matched" || !match.task.id) {
      return createSafeProposal("ask_clarification", {
        userMessage: input.userMessage,
        language: input.language,
        now,
        question: textFor(input.language, "clarify"),
        reason: match.status === "ambiguous"
          ? "Multiple matching tasks require clarification."
          : "Exact task target is required before updating a task.",
      });
    }
    if (!target?.title && !target?.notes && target?.dueDate === undefined) {
      return createSafeProposal("ask_clarification", {
        userMessage: input.userMessage,
        language: input.language,
        now,
        question: textFor(input.language, "clarify"),
        reason: "At least one task update field is required.",
      });
    }
    target!.taskId = match.task.id;
    target!.taskTitleHint = match.task.title;
  }
  if (type === "write_github_issue_comment" && findGithubIssueCommentTarget(target).status !== "matched") {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Exact repo, issue number, and comment body are required before approval.",
    });
  }
  if (type === "write_github_issue_update" && findGithubIssueUpdateTarget(target).status !== "matched") {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Exact repo, issue number, and at least one of title, body, or labels are required before approval.",
    });
  }

  const proposal: AgentIntentProposal = {
    id: safeString(input.rawProposal.id) || `intent:${type}:${now.toISOString()}`,
    type,
    confidence,
    userMessage: input.userMessage,
    target,
    requestedDomain: expectedDomain,
    toolId: expectedToolId,
    requiresTool: true,
    requiresApproval: CONFIRMED_WRITE_INTENT_TYPES.has(type),
    clarificationQuestion: undefined,
    reasons: safeReasons(input.rawProposal.reasons).length > 0
      ? safeReasons(input.rawProposal.reasons)
      : [`Validated ${type} intent.`],
    language: input.language,
    generatedAt: now.toISOString(),
    schemaVersion: AGENT_INTENT_SCHEMA_VERSION,
  };

  return {
    proposal,
    toolId: expectedToolId as KnownToolId,
    validationReasons: ["Intent proposal validated deterministically."],
  };
}

const MAX_DISAMBIGUATION_CANDIDATES = 3;

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => isRecord(item));
}

// Validates each raw candidate independently through validateAgentIntentProposal
// -- the exact same function a single confident proposal goes through, called
// once per candidate. There is no separate "candidate validation" path to
// drift from the real thing, and no candidate can reach a tool that a
// standalone proposal of the same type couldn't reach on its own.
//
// Sequence is enforced by data flow, not just by writing the steps in the
// right order: dedup only ever reads `.toolId` off an already-validated
// result (the deterministic map lookup), never anything from the raw
// candidate -- there is no raw field in scope to accidentally key off. Cap
// is applied to the deduped, validated survivor count, never the raw model
// output, so an invalid or duplicate candidate can never "use up" a slot
// and hide a genuine one. Above the cap, the leading candidates (in
// validated order) are kept rather than falling back to a plain
// clarification -- several real candidates is a strictly better outcome
// than forcing the user back into the free-text answer this feature exists
// to avoid.
export function resolveDisambiguationCandidates(input: {
  rawCandidates: unknown;
  userMessage: string;
  safeContext: AgentReasoningSafeContext;
  language: SupportedAiResponseLanguage;
  now: Date;
}): AgentReasoningValidationResult[] {
  if (!isRecordArray(input.rawCandidates) || input.rawCandidates.length === 0) {
    return [];
  }

  const validated = input.rawCandidates.map((candidate, index) =>
    validateAgentIntentProposal({
      rawProposal: {
        id: `intent:candidate:${index}:${input.now.toISOString()}`,
        type: candidate.type,
        confidence: "medium",
        reasons: candidate.reasons,
      },
      userMessage: input.userMessage,
      safeContext: input.safeContext,
      language: input.language,
      now: input.now,
    }),
  );

  // Only a genuinely resolved, read-only candidate survives. complete_task
  // is the only intent that requires approval; excluding it keeps
  // disambiguation scoped to read-only tools, so a Run click on any
  // surviving card never touches the approval boundary.
  const survivors = validated.filter(
    (result) => Boolean(result.toolId) && !result.proposal.requiresApproval,
  );

  const deduped: AgentReasoningValidationResult[] = [];
  const seenToolIds = new Set<string>();
  for (const result of survivors) {
    const toolId = result.toolId as string;
    if (seenToolIds.has(toolId)) continue;
    seenToolIds.add(toolId);
    deduped.push(result);
  }

  return deduped.slice(0, MAX_DISAMBIGUATION_CANDIDATES);
}
