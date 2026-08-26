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
import {
  parseDeterministicDueDate,
  parseDeterministicTimeRange,
  zonedDateTimeToUtcIso,
} from "./deterministicDates";
import {
  writeIntentRegistry,
  type WriteIntentToolId,
  type WriteIntentType,
} from "../../../../shared/writeIntentRegistry";
import { parseFinanceDirection } from "../../../../shared/financeDirection";

// Task 22-fix (C1): every existing call site of validateAgentIntentProposal
// omits `timeZone` (it wasn't a parameter before this fix), so this is the
// fallback used unless a caller passes one explicitly -- matches what
// ChatPage.tsx already sends the /chat endpoint's own `timeZone` field
// (`Intl.DateTimeFormat().resolvedOptions().timeZone`), not a guess.
function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Task 23: the four task/calendar write types are spliced in from the
// shared registry (in its own array order) instead of being listed here a
// second time -- see shared/writeIntentRegistry.ts.
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
  ...writeIntentRegistry.map((entry) => entry.intentType),
  "write_github_issue_comment",
  "write_github_issue_update",
  "propose_engineering_task",
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
// final requiresApproval assignment. Task 23: the four task/calendar write
// types come from the shared registry.
const CONFIRMED_WRITE_INTENT_TYPES = new Set<AgentIntentType>([
  "complete_task",
  ...writeIntentRegistry.map((entry) => entry.intentType),
  "write_github_issue_comment",
  "write_github_issue_update",
  "propose_engineering_task",
]);

const supportedDomains: AgentIntentDomain[] = [
  "tasks",
  "calendar",
  "finance",
  "learning",
  "workspace",
  "github",
];

const supportedConfidence: AgentIntentConfidence[] = ["low", "medium", "high"];

// Task 23: the four task/calendar entries below come from the shared
// registry (WRITE_INTENT_TOOL_ENTRIES/WRITE_INTENT_DOMAIN_ENTRIES), spread
// in at the exact same position the hand-written literals used to occupy --
// object spread preserves the registry array's own key order, so the
// resulting object's key order (and therefore anything that iterates it) is
// unchanged from before this refactor.
const WRITE_INTENT_TOOL_ENTRIES = Object.fromEntries(
  writeIntentRegistry.map((entry) => [entry.intentType, entry.toolId]),
) as Record<WriteIntentType, WriteIntentToolId>;

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
  ...WRITE_INTENT_TOOL_ENTRIES,
  write_github_issue_comment: "github.issues.comment",
  write_github_issue_update: "github.issues.update",
  propose_engineering_task: "engineering.task.propose",
} as const;

type KnownToolId = typeof intentToolMap[keyof typeof intentToolMap];

const WRITE_INTENT_DOMAIN_ENTRIES = Object.fromEntries(
  writeIntentRegistry.map((entry) => [entry.intentType, entry.domain]),
) as Record<WriteIntentType, AgentIntentDomain>;

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
  ...WRITE_INTENT_DOMAIN_ENTRIES,
  write_github_issue_comment: "github",
  write_github_issue_update: "github",
  propose_engineering_task: "github",
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

// A well-formed ISO-ish datetime string only -- never re-parsed from free
// text here (unlike dueDate below, which deterministic-date-overrides for
// tasks). Task 22's deterministic date/time reuse lives entirely in the
// Worker's own auto-write path (agent/worker/flow-write-policy.ts); this
// frontend validator has no equivalent time-of-day parser to reuse without
// duplicating it, so start/end follow the SAME "well-formed or dropped,
// never guessed" posture this file already uses for repo/issueNumber/body
// below -- a known, disclosed scope boundary, not an oversight.
function safeIsoDateTime(value: unknown) {
  const raw = safeString(value);
  if (!raw) return undefined;
  return Number.isNaN(Date.parse(raw)) ? undefined : raw;
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
    eventTitle: safeBoundedText(value.eventTitle, 200),
    eventReference: safeString(value.eventReference) || undefined,
    eventId: safeString(value.eventId) || undefined,
    start: safeIsoDateTime(value.start),
    end: safeIsoDateTime(value.end),
    // Task 28: amount/currency/direction/transactionDate/iban are all
    // OVERRIDDEN below (see the create_finance_transaction override step,
    // mirroring create_calendar_event's start/end override) -- the
    // well-formed-or-dropped read here is only ever a placeholder that
    // survives if the trigger below never fires (i.e. never reaches the
    // user). category/description have no deterministic re-derivation (out
    // of this task's stated parsing scope) so their model-proposed value
    // (bounded, never trusted beyond that) is what actually survives.
    amount: safeBoundedText(value.amount, 32),
    currency: safeBoundedText(value.currency, 8),
    direction: safeString(value.direction) || undefined,
    transactionDate: safeBoundedText(value.transactionDate, 32),
    category: safeBoundedText(value.category, 100),
    description: safeBoundedText(value.description, 500),
    iban: safeBoundedText(value.iban, 42),
    repo: safeRepoIdentifier(value.repo),
    issueNumber: safePositiveInteger(value.issueNumber),
    commentBody: safeBoundedText(value.commentBody, 10_000),
    updateTitle: safeBoundedText(value.updateTitle, 200),
    updateBody: safeBoundedText(value.updateBody, 10_000),
    updateLabels: safeLabelList(value.updateLabels),
    // Task 45c, ADR-0017: import_bank_statement's only target field. Reading
    // it here (well-formed-or-dropped, same as every other field in this
    // function) does NOT make the intent chat-reachable -- see
    // validateAgentIntentProposal's own explicit import_bank_statement guard
    // below, which converts the type to "unsupported" before this value is
    // ever inspected. A real batchId only ever comes from a prior
    // POST /finance/import-batch/preview call; no chat message could
    // legitimately supply one.
    batchId: safeString(value.batchId) || undefined,
    // ENG-04: repo above is reused. Never fuzzy-matched -- must be
    // explicit and well-formed or the proposal falls back to
    // ask_clarification (see findEngineeringTaskTarget below).
    engineeringInstruction: safeBoundedText(value.engineeringInstruction, 4000),
    engineeringTaskClass: safeString(value.engineeringTaskClass) || undefined,
  };
}

// Task 28: this surface's OWN deterministic amount/IBAN parsing, kept
// intentionally parallel to (not shared with) agent/worker/flow-write-
// policy.ts's identically-named logic -- the same "what stays hand-written"
// boundary this file's date parsers already follow (deterministicDates.ts
// is its own frontend-local copy of the Worker's date logic, not an import
// from it; see this file's own top-of-file import list). A model-proposed
// amount/IBAN must never survive to a preview or approval, the same rule
// task 22-fix's own C1 fix applied to a model-proposed calendar datetime.
function todayDateKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeDigitsForAmount(value: string): string {
  return value
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
}

const EURO_CURRENCY_PATTERN = /€|\beur\b|euro|یورو/i;
const AMOUNT_TOKEN_PATTERN = /[0-9]{1,3}(?:[.,٬][0-9]{3})+(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?/;

function parseDeterministicAmount(message: string): { amount?: string; currency?: string } {
  const text = normalizeDigitsForAmount(message);
  const match = text.match(AMOUNT_TOKEN_PATTERN);
  if (!match) return {};
  const raw = match[0];
  const decimalIndex = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
  let normalized: string;
  if (decimalIndex === -1) {
    normalized = raw.replace(/٬/g, "");
  } else {
    const integerPart = raw.slice(0, decimalIndex).replace(/[.,٬]/g, "");
    const fractionPart = raw.slice(decimalIndex + 1);
    normalized = fractionPart.length === 3 ? `${integerPart}${fractionPart}` : `${integerPart}.${fractionPart}`;
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return {};
  return { amount: String(amount), currency: EURO_CURRENCY_PATTERN.test(text) ? "EUR" : undefined };
}

// Task 42: extracted to shared/financeDirection.ts (this file's own copy
// and flow-write-policy.ts's parseFinanceDirection were hand duplicates --
// see that shared module's own header comment for why).

const IBAN_GROUPED_PATTERN = /\b[A-Za-z]{2}[0-9]{2}(?:\s[A-Za-z0-9]{4}){2,7}(?:\s[A-Za-z0-9]{1,4})?\b/;
const IBAN_COMPACT_PATTERN = /\b[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30}\b/;

function findIbanCandidate(message: string): string | undefined {
  return message.match(IBAN_GROUPED_PATTERN)?.[0] ?? message.match(IBAN_COMPACT_PATTERN)?.[0];
}

// ISO 7064 MOD 97-10 -- see agent/worker/flow-write-policy.ts's own comment
// on its copy of this exact algorithm for the full rationale (BigInt
// required, not optional, for precision beyond Number.MAX_SAFE_INTEGER).
export function isValidIbanClientSide(candidate: string): boolean {
  const iban = candidate.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  try {
    return BigInt(numeric) % 97n === 1n;
  } catch {
    return false;
  }
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

// ENG-04: same "explicit and well-formed or missing" shape as
// findGithubIssueUpdateTarget above -- an engineering task is a HIGH-risk,
// unattended action (it runs Claude Code end to end with no mid-execution
// pause), so it requires unambiguous target fields, never a best-effort
// guess.
function findEngineeringTaskTarget(target: ReturnType<typeof normalizeTarget>) {
  if (!target?.repo || !target.engineeringInstruction || !target.engineeringTaskClass) {
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

function findCalendarEventTarget(
  context: AgentReasoningSafeContext,
  target: ReturnType<typeof normalizeTarget>,
) {
  const events = context.events;
  if (!target) return { status: "missing" as const };

  if (target.eventId) {
    const event = events.find((item) => item.id === target.eventId);
    return event ? { status: "matched" as const, event } : { status: "missing" as const };
  }

  const reference = normalizeTitle(target.eventReference ?? "");
  if (!reference) return { status: "missing" as const };
  const matches = events.filter((event) => {
    const title = normalizeTitle(event.title ?? "");
    return title === reference || title.includes(reference) || reference.includes(title);
  });
  if (matches.length === 1) return { status: "matched" as const, event: matches[0] };
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

// Task 22 (calendar write slice): same two-clause shape as the task
// versions above, anchored on calendar-flavored nouns instead. Noun-gated
// (not bare verbs) so "reschedule"/"move"/"verschiebe" -- already claimed
// by requestLooksLikeTaskUpdate when paired with a task noun -- only match
// here when paired with a calendar noun instead; a message naming BOTH
// noun classes matches both functions, which the writeRequestCount/
// conflictingWriteRequest machinery below already treats as genuinely
// ambiguous, not a guess to make.
function requestLooksLikeCalendarCreate(message: string) {
  return /\b(create|add|set up|schedule|erstelle|hinzuf[\u00fcu]gen)\b.{0,40}\b(event|appointment|meeting|calendar)\b/i.test(message) ||
    /(\u0631\u0648\u06cc\u062f\u0627\u062f|\u062c\u0644\u0633\u0647|\u0642\u0631\u0627\u0631|\u0645\u0644\u0627\u0642\u0627\u062a).{0,40}(\u0628\u0633\u0627\u0632|\u0627\u06cc\u062c\u0627\u062f\s+\u06a9\u0646|\u0627\u0636\u0627\u0641\u0647\s+\u06a9\u0646)/i.test(message);
}

function requestLooksLikeCalendarUpdate(message: string) {
  return /\b(update|edit|change|move|reschedule|aktualisiere|bearbeite|verschiebe)\b.{0,50}\b(event|appointment|meeting|calendar)\b/i.test(message) ||
    /(\u0631\u0648\u06cc\u062f\u0627\u062f|\u062c\u0644\u0633\u0647|\u0642\u0631\u0627\u0631|\u0645\u0644\u0627\u0642\u0627\u062a).{0,50}(\u0628\u0647[\u200c\s-]?\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc\s+\u06a9\u0646|\u0648\u06cc\u0631\u0627\u06cc\u0634\s+\u06a9\u0646|\u062a\u063a\u06cc\u06cc\u0631\s+\u0628\u062f\u0647)/i.test(message);
}

// Task 28 (finance write slice) -- same noun-gated shape as the task/
// calendar create triggers above, kept intentionally parallel to (not
// shared with) agent/worker/flow-write-policy.ts's isFinanceWriteTrigger.
// Create-only: there is no create_finance_transaction update sibling to
// mirror an "update" trigger for.
function requestLooksLikeFinanceCreate(message: string) {
  return /\b(log|record|add|create)\b.{0,40}\b(expense|income|transaction|payment)\b/i.test(message) ||
    /\b(i\s+)?(spent|paid|bought)\b.{0,40}\b(on|for|euro|eur|\u20ac|\d)/i.test(message) ||
    /\b(pay|send|transfer)\b.{0,40}\b(euro|eur|\u20ac|\d|[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,30})/i.test(message) ||
    /\b(erfasse|buche|trage)\b.{0,40}\b(ausgabe|einnahme|transaktion|zahlung)\b/i.test(message) ||
    /(\u0647\u0632\u06cc\u0646\u0647|\u062f\u0631\u0622\u0645\u062f|\u062a\u0631\u0627\u06a9\u0646\u0634|\u067e\u0631\u062f\u0627\u062e\u062a).{0,40}(\u062b\u0628\u062a \u06a9\u0646|\u0627\u0636\u0627\u0641\u0647 \u06a9\u0646|\u0628\u0633\u0627\u0632|\u062b\u0628\u062a \u0634\u0648\u062f)/.test(message);
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

// ENG-04: deliberately narrow -- a false positive here means SmartFlow
// proposes an unattended, real-repo, real-money coding-agent run from an
// offhand remark. Requires an unambiguous engineering-task phrase, not a
// generic "fix"/"build"/"add" verb that would collide with everyday chat.
function requestLooksLikeEngineeringTask(message: string) {
  return (
    /\b(engineering task|run claude code|have claude code|coding agent task|run an? (coding|code) task)\b/i.test(message) ||
    /(تسک مهندسی|وظیفه مهندسی)/i.test(message) ||
    // ENG-06d: German was missing entirely -- this app ships de/fa
    // alongside en, and every OTHER write-intent gate in this file already
    // covers German, so a German engineering-task request silently lost
    // its propose_engineering_task type to read-intent normalization and
    // produced no approval card at all. Held to the same deliberately
    // narrow standard as the en/fa patterns above: unambiguous
    // engineering-task phrases only, never a bare "bau"/"repariere" verb
    // that would collide with everyday chat. "Engineering-Task" also
    // matches the unhyphenated and spaced compounds German writers vary
    // between.
    /(\bengineering[-\s]?task\b|\bcoding[-\s]?agent[-\s]?task\b|\bclaude code (ausführen|laufen lassen|starten)\b|\bentwicklungsaufgabe\b|\bprogrammieraufgabe\b)/i.test(message)
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
type ReadToolIntentType = Exclude<AgentIntentType, "complete_task" | "create_task" | "update_task" | "create_calendar_event" | "update_calendar_event" | "write_github_issue_comment" | "write_github_issue_update" | "propose_engineering_task" | "ask_clarification" | "unsupported">;

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
  timeZone?: string;
}): AgentReasoningValidationResult {
  const now = input.now ?? new Date();
  // Task 22-fix (C1): was hardcoded to "Europe/Berlin" regardless of the
  // actual user -- every deterministic date resolution on this path used
  // the wrong timezone for anyone outside it. `timeZone` is optional so
  // existing callers/tests keep working; production callers should pass
  // the same value already sent to /chat (see defaultTimeZone above).
  const timeZone = input.timeZone ?? defaultTimeZone();
  const deterministicDueDate = parseDeterministicDueDate(input.userMessage, now, timeZone);
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

  // Task 45c, ADR-0017: import_bank_statement is registered in
  // shared/writeIntentRegistry.ts (for its undo-kind/domain/write-runtime
  // metadata -- see that entry's own comment) but must NEVER become a real
  // chat proposal. As of task 45c PART B (Ruling 2, PO), the entry's own
  // `exposure: 'ui-only'` field is the PRIMARY mechanism: the model cannot
  // even output this type (agent/worker/reasoning-endpoint.ts's
  // SUPPORTED_INTENT_VALUES enum excludes it under Gemini's structured-
  // output constraint) and never reads a prompt sentence naming it
  // (reasoningPrompt.ts filters the same way, both keyed off `exposure`).
  // Registry membership alone still does not make this guard redundant,
  // though: import_bank_statement is registry-derived into
  // supportedIntentTypes/CONFIRMED_WRITE_INTENT_TYPES above (so it would
  // otherwise pass the normal write-intent checks below unchanged) --
  // this explicit check is the BACKSTOP for a malformed/bypassed model
  // response, a future regression in the exposure filter, or this
  // function being reused against some other input source entirely. If
  // the model ever names this type regardless -- whatever its target
  // looks like -- it is rejected here, before target normalization,
  // before any approval-card path, with no clarification offered
  // (clarifying would imply the user could supply what's missing via
  // chat; they cannot -- a real batchId only exists after a UI-driven
  // POST /finance/import-batch/preview call). See writeIntentRegistry.ts's
  // entry comment for the other layers (an unfakeable required target
  // field, no registered write handler).
  if (initialType === 'import_bank_statement') {
    return createSafeProposal('unsupported', {
      userMessage: input.userMessage,
      language: input.language,
      now,
      reason: 'import_bank_statement is UI-only and can never be proposed from chat.',
    });
  }

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
  // Task 22: an EXPLICIT calendar-noun match (event/meeting/appointment/...)
  // is independent write evidence, counted into writeRequestCount below
  // exactly like the task/GitHub signals -- so "create a task for the
  // meeting tomorrow" (task noun + calendar noun) is genuinely ambiguous,
  // not a guess. A time-of-day WITHOUT an explicit calendar noun is a
  // separate, weaker signal (tasks have no time-of-day field) -- applied as
  // a post-step below (timeForcesCalendar), not counted here, so it never
  // manufactures a false conflict against the task branch it would
  // otherwise have resolved to.
  const messageHasTime = /\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/.test(input.userMessage) ||
    /\b(?:at|um)\s+([01]?[0-9]|2[0-3])(?::[0-5][0-9])?\s*(?:am|pm|uhr)?\b/i.test(input.userMessage) ||
    /ساعت\s+[۰-۹0-9]{1,2}/.test(input.userMessage);
  const calendarCreateRequested = requestLooksLikeCalendarCreate(input.userMessage);
  const calendarUpdateRequested = requestLooksLikeCalendarUpdate(input.userMessage);
  const financeCreateRequested = requestLooksLikeFinanceCreate(input.userMessage);
  const engineeringTaskRequested = requestLooksLikeEngineeringTask(input.userMessage);
  const writeRequestCount = [commentRequested, issueUpdateRequested, taskCreateRequested, taskUpdateRequested, completionRequested, calendarCreateRequested, calendarUpdateRequested, financeCreateRequested, engineeringTaskRequested]
    .filter(Boolean).length;
  const conflictingWriteRequest = writeRequestCount > 1;
  const mixedReadWriteRequest = requestLooksMixed(input.userMessage, "inspect_tasks");
  // An unrecognized type is treated the same as a total parse failure (fallbackRawProposal
  // also starts from "ask_clarification"): fall through to deterministic evidence-based
  // normalization instead of rejecting immediately. The rescued type still comes only from
  // regex evidence over the user's own message, never from whatever the LLM proposed.
  const normalizationSourceType = initialTypeSupported ? initialType : "ask_clarification";
  const baseType = completionRequested &&
    !mixedReadWriteRequest &&
    (normalizationSourceType === "ask_clarification" || normalizationSourceType === "inspect_tasks" || normalizationSourceType === "complete_task")
    ? "complete_task"
    : calendarCreateRequested &&
      !conflictingWriteRequest &&
      !mixedReadWriteRequest &&
      (normalizationSourceType === "ask_clarification" || normalizationSourceType === "inspect_calendar" || normalizationSourceType === "create_calendar_event")
      ? "create_calendar_event"
      : calendarUpdateRequested &&
        !conflictingWriteRequest &&
        !mixedReadWriteRequest &&
        (normalizationSourceType === "ask_clarification" || normalizationSourceType === "inspect_calendar" || normalizationSourceType === "update_calendar_event")
        ? "update_calendar_event"
    : financeCreateRequested &&
      !conflictingWriteRequest &&
      !mixedReadWriteRequest &&
      (normalizationSourceType === "ask_clarification" || normalizationSourceType === "create_finance_transaction")
      ? "create_finance_transaction"
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
        : engineeringTaskRequested &&
          !conflictingWriteRequest &&
          !mixedReadWriteRequest &&
          (normalizationSourceType === "ask_clarification" || normalizationSourceType === "propose_engineering_task")
          ? "propose_engineering_task"
        : normalizeReadIntentFromEvidence(normalizationSourceType, domainEvidence, input.userMessage);
  // Task 22 post-step: a time-of-day forces calendar routing even without
  // an explicit calendar noun (tasks have no time-of-day field) -- applied
  // AFTER the main resolution above, not folded into writeRequestCount, so
  // it can never manufacture a false conflict against the task branch it
  // is about to override. Only swaps a clean, unconflicted create_task/
  // update_task resolution -- never touches any other type (ambiguous,
  // clarification, GitHub writes, reads all pass through unchanged).
  const type = messageHasTime && baseType === "create_task"
    ? "create_calendar_event"
    : messageHasTime && baseType === "update_task"
      ? "update_calendar_event"
      : baseType;
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
  // Task 22: when the time-forces-calendar post-step (above) reclassifies
  // a create_task/update_task proposal into its calendar sibling, the
  // model itself was never told to populate eventTitle/eventReference --
  // it populated title/taskReference, believing it was proposing a task.
  // Bridge that naming gap here rather than silently failing calendar's
  // own "eventTitle is required" check on a proposal that DID name a
  // subject, just under the task-shaped field name.
  if ((type === "create_calendar_event" || type === "update_calendar_event") && target) {
    if (!target.eventTitle && target.title) target.eventTitle = target.title;
    if (!target.eventReference && target.taskReference) target.eventReference = target.taskReference;
  }
  // Task 22-fix (C1): a model-supplied datetime must never survive to a
  // preview or an execution -- production evidence showed the model's own
  // guessed start date reaching the approval card verbatim (a full month
  // off), because this file previously only checked start/end were
  // well-formed, never re-derived them. Deterministically resolve start/end
  // from the user's own message the same way the Worker's auto-write path
  // already does (parseDeterministicTimeRange + zonedDateTimeToUtcIso) and
  // OVERRIDE whatever the model proposed. When the message doesn't
  // deterministically resolve both a date and a time, drop the model's
  // value entirely (never partially trust it) so the "start time is
  // required" check below asks for clarification instead of shipping an
  // unverified guess. create_calendar_event has no existing event to fall
  // back on, so it requires an explicit date phrase in THIS message; the
  // update_calendar_event sibling below (after the target is matched to a
  // safe-context event) additionally falls back to that event's own
  // existing date when the message only carries a new time.
  if (type === "create_calendar_event" && target) {
    const timeRange = parseDeterministicTimeRange(input.userMessage);
    if (timeRange.start && deterministicDueDate.value) {
      const resolvedStart = zonedDateTimeToUtcIso(deterministicDueDate.value, timeRange.start, timeZone);
      target.start = resolvedStart;
      target.end = timeRange.end
        ? zonedDateTimeToUtcIso(deterministicDueDate.value, timeRange.end, timeZone)
        : new Date(new Date(resolvedStart).getTime() + 60 * 60 * 1000).toISOString();
    } else {
      target.start = undefined;
      target.end = undefined;
    }
  }
  // Task 28: same "never trust the model's own value" rule as
  // create_calendar_event's start/end override above, applied to
  // amount/currency/direction/iban -- every one of these is re-derived
  // from the raw message and OVERWRITES whatever the model proposed.
  // transactionDate defaults to today when the message names no date
  // (create_finance_transaction tolerates an absent date, unlike
  // create_calendar_event's start, which is required -- see
  // createRequiredTargetFields in the shared registry).
  if (type === "create_finance_transaction" && target) {
    const ibanCandidate = findIbanCandidate(input.userMessage);
    const messageForAmount = ibanCandidate ? input.userMessage.replace(ibanCandidate, " ") : input.userMessage;
    const { amount, currency } = parseDeterministicAmount(messageForAmount);
    target.amount = amount;
    target.currency = currency;
    target.direction = parseFinanceDirection(input.userMessage);
    // Unmentioned defaults to today, in the request's own timeZone (this
    // domain tolerates an absent date, unlike create_calendar_event's
    // start) -- mirrors agent/worker/flow-write-policy.ts's own
    // `date.value ?? dateKey(now, timeZone)`.
    target.transactionDate = deterministicDueDate.value ?? todayDateKey(now, timeZone);
    target.iban = ibanCandidate ? ibanCandidate.replace(/\s+/g, "").toUpperCase() : undefined;
  }
  if ((type === "create_task" || type === "update_task") && target && deterministicDueDate.value !== undefined) {
    target.dueDate = deterministicDueDate.value;
  }
  if ((type === "create_task" || type === "update_task") && deterministicDueDate.clarificationNeeded) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Exact due date is required before preparing a task write.",
    });
  }
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
  if (type === "create_calendar_event" && !target?.eventTitle) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Event title is required before creating a calendar event.",
    });
  }
  if (type === "create_calendar_event" && !target?.start) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Exact start time is required before creating a calendar event.",
    });
  }
  if (type === "update_calendar_event") {
    const match = findCalendarEventTarget(input.safeContext, target);
    if (match.status !== "matched" || !match.event.id) {
      return createSafeProposal("ask_clarification", {
        userMessage: input.userMessage,
        language: input.language,
        now,
        question: textFor(input.language, "clarify"),
        reason: match.status === "ambiguous"
          ? "Multiple matching calendar events require clarification."
          : "Exact calendar event target is required before updating it.",
      });
    }
    // Task 22-fix (C1): same "never trust the model's datetime" rule as
    // create_calendar_event above, but an update may legitimately only be
    // changing the TIME ("move the Standup event to 10am") with no new
    // date phrase in the message at all -- unlike create, there IS an
    // existing event here, so fall back to ITS own date instead of
    // requiring a fresh date phrase, mirroring the Worker's own
    // executeAutoCalendarWrite (`intent.startDate ?? before.date`).
    if (target) {
      const timeRange = parseDeterministicTimeRange(input.userMessage);
      const anchorDate = deterministicDueDate.value ?? match.event.dateTimeStart?.slice(0, 10);
      if (timeRange.start && anchorDate) {
        const resolvedStart = zonedDateTimeToUtcIso(anchorDate, timeRange.start, timeZone);
        target.start = resolvedStart;
        target.end = timeRange.end
          ? zonedDateTimeToUtcIso(anchorDate, timeRange.end, timeZone)
          : new Date(new Date(resolvedStart).getTime() + 60 * 60 * 1000).toISOString();
      } else {
        target.start = undefined;
        target.end = undefined;
      }
    }
    if (!target?.eventTitle && !target?.start && !target?.end) {
      return createSafeProposal("ask_clarification", {
        userMessage: input.userMessage,
        language: input.language,
        now,
        question: textFor(input.language, "clarify"),
        reason: "At least one calendar event update field is required.",
      });
    }
    target!.eventId = match.event.id;
  }
  if (type === "create_finance_transaction" && !target?.amount) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "An exact amount is required before recording a transaction.",
    });
  }
  if (type === "create_finance_transaction" && !target?.direction) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Whether this is income or an expense is required before recording a transaction.",
    });
  }
  // Task 28: an IBAN-shaped token that fails the mod-97 check is a typed
  // rejection, never a silent drop or a silent pass -- ask_clarification
  // (not unsupported) since the rest of the transaction may still be
  // well-formed; the user can correct just the IBAN.
  if (type === "create_finance_transaction" && target?.iban && !isValidIbanClientSide(target.iban)) {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "The IBAN mentioned does not pass validation and must be corrected before approval.",
    });
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
  if (type === "propose_engineering_task" && findEngineeringTaskTarget(target).status !== "matched") {
    return createSafeProposal("ask_clarification", {
      userMessage: input.userMessage,
      language: input.language,
      now,
      question: textFor(input.language, "clarify"),
      reason: "Exact repo, instruction, and a task class are required before approval.",
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
