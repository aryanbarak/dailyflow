import type { AgentReflectionResult } from "./reflectionTypes";
import type {
  WorkspaceDecisionProfile,
  WorkspaceSignalDomain,
} from "../workspace/workspaceTypes";

export const CONTEXT_SYNTHESIS_VERSION = "context-synthesis-v1" as const;

export type ContextSynthesisConfidence = "low" | "medium" | "high";
export type ContextSynthesisLanguage = "en" | "de" | "fa";
export type ContextSynthesisEvidenceDomain = WorkspaceSignalDomain | "github";

export interface ContextSynthesisWorkspaceContext {
  activeTaskCount?: number;
  dueTodayCount?: number;
  overdueCount?: number;
  unscheduledTaskCount?: number;
  completedThisWeekCount?: number;
  todayEventCount?: number;
  currentGoalTitle?: string;
  currentPrimaryDomain?: WorkspaceSignalDomain;
  learningActiveCount?: number;
  learningProgressSummary?: string;
}

export interface ContextSynthesisInput {
  toolId?: string;
  executionStatus: string;
  safeRuntimeSummary: string;
  safePreviewItems?: readonly string[];
  reflection?: AgentReflectionResult;
  workspaceContext?: ContextSynthesisWorkspaceContext;
  decisionProfile?: WorkspaceDecisionProfile;
  responseLanguage: ContextSynthesisLanguage;
  generatedAt: string;
}

export interface SynthesizedContext {
  primaryFact?: string;
  supportingFacts: string[];
  derivedInsight?: string;
  safeSuggestion?: string;
  evidenceDomains: ContextSynthesisEvidenceDomain[];
  confidence: ContextSynthesisConfidence;
  synthesisVersion: typeof CONTEXT_SYNTHESIS_VERSION;
}

const SUPPORTED_TOOL_IDS = new Set([
  "tasks.list",
  "calendar.list_today",
  "learning.get_progress",
  "workspace.get_context",
  "tasks.complete",
  "github.repositories.list",
  "github.issues.list",
  "github.pulls.list",
  "github.workflow_runs.list",
]);

const INTERNAL_PATTERN =
  /\b(requestId|stepId|auditId|audit|policyDecision|policy|schema|userId|supabase|prompt|access_token)\b\s*[:=]?\s*[\w:./-]*/gi;

function cleanText(value: string | undefined) {
  return (value ?? "")
    .replace(INTERNAL_PATTERN, "")
    .replace(/[{}[\]"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedCount(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function countFromSummary(summary: string, zeroPattern: RegExp) {
  const clean = cleanText(summary);
  if (zeroPattern.test(clean)) return 0;
  const match = clean.match(/\b(\d+)\b/);
  if (!match) return undefined;
  return Number(match[1]);
}

function emptyResult(confidence: ContextSynthesisConfidence = "low"): SynthesizedContext {
  return Object.freeze({
    supportingFacts: Object.freeze([]) as string[],
    evidenceDomains: Object.freeze([]) as ContextSynthesisEvidenceDomain[],
    confidence,
    synthesisVersion: CONTEXT_SYNTHESIS_VERSION,
  });
}

function taskPrimaryFact(openCount: number | undefined, dueToday: number, language: ContextSynthesisLanguage) {
  if (typeof openCount !== "number") return undefined;
  if (language === "de") {
    return `${dueToday} von ${openCount} offenen ${openCount === 1 ? "Aufgabe" : "Aufgaben"} ${dueToday === 1 ? "ist" : "sind"} heute faellig.`;
  }
  if (language === "fa") {
    return `\u0627\u0645\u0631\u0648\u0632 ${dueToday} \u0645\u0648\u0631\u062f \u0627\u0632 ${openCount} \u06a9\u0627\u0631 \u0628\u0627\u0632 \u0645\u0648\u0639\u062f \u062f\u0627\u0631\u062f.`;
  }
  return `${dueToday} of your ${openCount} open ${openCount === 1 ? "task" : "tasks"} ${dueToday === 1 ? "is" : "are"} due today.`;
}

function taskUnscheduledFact(count: number, language: ContextSynthesisLanguage) {
  if (language === "de") return `${count} offene ${count === 1 ? "Aufgabe hat" : "Aufgaben haben"} kein Faelligkeitsdatum.`;
  if (language === "fa") return `${count} \u06a9\u0627\u0631 \u0628\u0627\u0632 \u0628\u062f\u0648\u0646 \u062a\u0627\u0631\u06cc\u062e \u0645\u0648\u0639\u062f \u0627\u0633\u062a.`;
  return `${count} open ${count === 1 ? "task does" : "tasks do"} not have due dates.`;
}

function taskCompletedFact(completed: number, dueToday: number, language: ContextSynthesisLanguage) {
  if (language === "de") return `Du hast diese Woche ${completed} ${completed === 1 ? "Aufgabe" : "Aufgaben"} erledigt und heute ${dueToday} faellige ${dueToday === 1 ? "Aufgabe" : "Aufgaben"}.`;
  if (language === "fa") return `\u0627\u06cc\u0646 \u0647\u0641\u062a\u0647 ${completed} \u06a9\u0627\u0631 \u0627\u0646\u062c\u0627\u0645 \u062f\u0627\u062f\u06cc \u0648 \u0627\u0645\u0631\u0648\u0632 ${dueToday} \u06a9\u0627\u0631 \u0645\u0648\u0639\u062f \u062f\u0627\u0631\u062f.`;
  return `You completed ${completed} ${completed === 1 ? "task" : "tasks"} this week and have ${dueToday} due today.`;
}

function taskSuggestion(language: ContextSynthesisLanguage) {
  if (language === "de") return "Du konntest diesen Aufgaben Faelligkeitsdaten geben.";
  if (language === "fa") return "\u0645\u06cc\u062a\u0648\u0627\u0646\u06cc \u0628\u0631\u0627\u06cc \u0627\u06cc\u0646 \u06a9\u0627\u0631\u0647\u0627 \u062a\u0627\u0631\u06cc\u062e \u0645\u0648\u0639\u062f \u0627\u0636\u0627\u0641\u0647 \u06a9\u0646\u06cc.";
  return "You may want to add due dates to those tasks.";
}

function calendarOpenWithTaskFact(dueToday: number, language: ContextSynthesisLanguage) {
  if (language === "de") return `Dein Kalender ist heute offen, waehrend ${dueToday} ${dueToday === 1 ? "Aufgabe" : "Aufgaben"} faellig ist.`;
  if (language === "fa") return `\u062a\u0642\u0648\u06cc\u0645\u062a \u0627\u0645\u0631\u0648\u0632 \u062e\u0627\u0644\u06cc \u0627\u0633\u062a \u0648 ${dueToday} \u06a9\u0627\u0631 \u0645\u0648\u0639\u062f \u062f\u0627\u0631\u062f.`;
  return `Your calendar is open today, while ${dueToday} ${dueToday === 1 ? "task is" : "tasks are"} due.`;
}

function calendarSuggestion(language: ContextSynthesisLanguage) {
  if (language === "de") return "Du konntest den offenen Kalender fuer fokussierte Arbeit nutzen.";
  if (language === "fa") return "\u0645\u06cc\u062a\u0648\u0627\u0646\u06cc \u0627\u0632 \u062a\u0642\u0648\u06cc\u0645 \u062e\u0627\u0644\u06cc \u0628\u0631\u0627\u06cc \u06a9\u0627\u0631 \u0645\u062a\u0645\u0631\u06a9\u0632 \u0627\u0633\u062a\u0641\u0627\u062f\u0647 \u06a9\u0646\u06cc.";
  return "You could use the open calendar for focused work.";
}

function learningPrimaryFact(count: number, language: ContextSynthesisLanguage) {
  if (language === "de") return `Lernen ist Teil des heutigen Ziels, und ${count} ${count === 1 ? "aktiver Lerneintrag ist" : "aktive Lerneintraege sind"} bereit.`;
  if (language === "fa") return `\u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc \u0628\u062e\u0634\u06cc \u0627\u0632 \u0647\u062f\u0641 \u0627\u0645\u0631\u0648\u0632 \u0627\u0633\u062a \u0648 ${count} \u0645\u0648\u0631\u062f \u0641\u0639\u0627\u0644 \u0628\u0631\u0627\u06cc \u0627\u062f\u0627\u0645\u0647 \u0622\u0645\u0627\u062f\u0647 \u0627\u0633\u062a.`;
  return `Learning is part of today's goal, and ${count} active ${count === 1 ? "item is" : "items are"} ready to continue.`;
}

function recurringDomainFact(domain: WorkspaceSignalDomain, language: ContextSynthesisLanguage) {
  if (language === "de") return `${domainLabel(domain, language)} war zuletzt wiederholt Teil deiner Workspace-Aktivitaet.`;
  if (language === "fa") return `\u062d\u0648\u0632\u0647 ${domainLabel(domain, language)} \u0627\u062e\u06cc\u0631\u0627 \u0686\u0646\u062f \u0628\u0627\u0631 \u062f\u0631 \u0641\u0639\u0627\u0644\u06cc\u062a \u0648\u0631\u06a9\u0633\u067e\u06cc\u0633\u062a \u062f\u06cc\u062f\u0647 \u0634\u062f\u0647 \u0627\u0633\u062a.`;
  return `${domainLabel(domain, language)} has been a recurring part of your recent activity.`;
}

function domainLabel(domain: WorkspaceSignalDomain, language: ContextSynthesisLanguage) {
  const labels: Record<ContextSynthesisLanguage, Record<WorkspaceSignalDomain, string>> = {
    en: {
      tasks: "Tasks",
      calendar: "Calendar",
      learning: "Learning",
      habits: "Habits",
      finance: "Finance",
      documents: "Documents",
    },
    de: {
      tasks: "Aufgaben",
      calendar: "Kalender",
      learning: "Lernen",
      habits: "Gewohnheiten",
      finance: "Finanzen",
      documents: "Dokumente",
    },
    fa: {
      tasks: "\u06a9\u0627\u0631\u0647\u0627",
      calendar: "\u062a\u0642\u0648\u06cc\u0645",
      learning: "\u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc",
      habits: "\u0639\u0627\u062f\u0627\u062a",
      finance: "\u0645\u0627\u0644\u06cc",
      documents: "\u0627\u0633\u0646\u0627\u062f",
    },
  };
  return labels[language][domain];
}

function workspaceGoalFact(goalTitle: string | undefined, domain: WorkspaceSignalDomain | undefined, language: ContextSynthesisLanguage) {
  const title = cleanText(goalTitle);
  if (!title || !domain) return undefined;
  if (language === "de") return `Das heutige Ziel ist ${domainLabel(domain, language).toLowerCase()}-orientiert: ${title}.`;
  if (language === "fa") return `\u0647\u062f\u0641 \u0627\u0645\u0631\u0648\u0632 \u0628\u0647 \u062d\u0648\u0632\u0647 ${domainLabel(domain, language)} \u0645\u0631\u0628\u0648\u0637 \u0627\u0633\u062a: ${title}.`;
  return `Today's goal is ${domainLabel(domain, language).toLowerCase()}-focused: ${title}.`;
}

function withFact(facts: string[], fact: string | undefined) {
  const cleaned = cleanText(fact);
  if (cleaned && !facts.includes(cleaned) && facts.length < 3) {
    facts.push(cleaned);
  }
}

function repeatedEvidenceDomain(reflection: AgentReflectionResult | undefined): WorkspaceSignalDomain | undefined {
  if (!reflection?.evidence?.length) return undefined;
  const counts = new Map<WorkspaceSignalDomain, number>();
  for (const item of reflection.evidence) {
    if (
      item.domain &&
      item.domain !== "workspace" &&
      item.domain !== "github" &&
      item.domain !== "conversations" &&
      (item.outcome === "successful" || item.outcome === "empty") &&
      item.usefulness !== "none"
    ) {
      counts.set(item.domain, (counts.get(item.domain) ?? 0) + 1);
    }
  }

  for (const [domain, count] of counts.entries()) {
    if (count >= 2) return domain;
  }
  return undefined;
}

function decisionSupportsDomain(
  decisionProfile: WorkspaceDecisionProfile | undefined,
  domain: WorkspaceSignalDomain | undefined,
) {
  if (!decisionProfile || !domain) return false;
  if (decisionProfile.lowData || decisionProfile.decisionConfidence === "low") return false;
  return (
    decisionProfile.reliableDomains.includes(domain) ||
    decisionProfile.recentSuccessDomains.includes(domain)
  );
}

function confidence(hasPrimary: boolean, supportingFacts: readonly string[], conflict: boolean): ContextSynthesisConfidence {
  if (conflict) return "low";
  if (hasPrimary && supportingFacts.length >= 2) return "high";
  if (hasPrimary || supportingFacts.length > 0) return "medium";
  return "low";
}

function synthesizeTasks(input: ContextSynthesisInput): SynthesizedContext {
  const context = input.workspaceContext ?? {};
  const runtimeOpenCount = countFromSummary(input.safeRuntimeSummary, /^no active tasks found\.?$/i);
  const activeTaskCount = boundedCount(context.activeTaskCount);
  const dueToday = boundedCount(context.dueTodayCount) ?? 0;
  const unscheduled = boundedCount(context.unscheduledTaskCount) ?? 0;
  const completedThisWeek = boundedCount(context.completedThisWeekCount) ?? 0;
  const hasConflict =
    typeof runtimeOpenCount === "number" &&
    typeof activeTaskCount === "number" &&
    runtimeOpenCount !== activeTaskCount;

  if (hasConflict) return emptyResult("low");

  const openCount = typeof runtimeOpenCount === "number" ? runtimeOpenCount : activeTaskCount;
  const supportingFacts: string[] = [];
  const primaryFact = dueToday > 0 ? taskPrimaryFact(openCount, dueToday, input.responseLanguage) : undefined;

  if (unscheduled > 0) withFact(supportingFacts, taskUnscheduledFact(unscheduled, input.responseLanguage));
  if (completedThisWeek > 0 && dueToday > 0) {
    withFact(supportingFacts, taskCompletedFact(completedThisWeek, dueToday, input.responseLanguage));
  }

  const repeated = repeatedEvidenceDomain(input.reflection);
  if (repeated === "tasks" && decisionSupportsDomain(input.decisionProfile, repeated)) {
    withFact(supportingFacts, recurringDomainFact(repeated, input.responseLanguage));
  }

  return Object.freeze({
    primaryFact,
    supportingFacts: Object.freeze(supportingFacts) as string[],
    safeSuggestion: unscheduled > 0 ? taskSuggestion(input.responseLanguage) : undefined,
    evidenceDomains: Object.freeze(["tasks"]) as WorkspaceSignalDomain[],
    confidence: confidence(Boolean(primaryFact), supportingFacts, false),
    synthesisVersion: CONTEXT_SYNTHESIS_VERSION,
  });
}

function synthesizeCalendar(input: ContextSynthesisInput): SynthesizedContext {
  const context = input.workspaceContext ?? {};
  const runtimeEventCount = countFromSummary(input.safeRuntimeSummary, /^no events today\.?$/i);
  const todayEventCount = boundedCount(context.todayEventCount);
  const dueToday = boundedCount(context.dueTodayCount) ?? 0;
  const hasConflict =
    typeof runtimeEventCount === "number" &&
    typeof todayEventCount === "number" &&
    runtimeEventCount !== todayEventCount;

  if (hasConflict) return emptyResult("low");

  const eventCount = typeof runtimeEventCount === "number" ? runtimeEventCount : todayEventCount;
  const primaryFact = eventCount === 0 && dueToday > 0
    ? calendarOpenWithTaskFact(dueToday, input.responseLanguage)
    : undefined;

  return Object.freeze({
    primaryFact,
    supportingFacts: Object.freeze([]) as string[],
    safeSuggestion: eventCount === 0 ? calendarSuggestion(input.responseLanguage) : undefined,
    evidenceDomains: Object.freeze(["calendar", ...(dueToday > 0 ? ["tasks" as const] : [])]) as WorkspaceSignalDomain[],
    confidence: primaryFact ? "medium" : "low",
    synthesisVersion: CONTEXT_SYNTHESIS_VERSION,
  });
}

function synthesizeLearning(input: ContextSynthesisInput): SynthesizedContext {
  const context = input.workspaceContext ?? {};
  const runtimeCount = countFromSummary(input.safeRuntimeSummary, /^no learning progress found\.?$/i);
  const activeCount = boundedCount(context.learningActiveCount);
  const hasConflict =
    typeof runtimeCount === "number" &&
    typeof activeCount === "number" &&
    runtimeCount > 0 &&
    activeCount === 0;

  if (hasConflict) return emptyResult("low");

  const count = activeCount ?? runtimeCount ?? 0;
  const supportingFacts: string[] = [];
  const primaryFact = count > 0 && context.currentPrimaryDomain === "learning"
    ? learningPrimaryFact(count, input.responseLanguage)
    : undefined;

  if (decisionSupportsDomain(input.decisionProfile, "learning")) {
    withFact(supportingFacts, recurringDomainFact("learning", input.responseLanguage));
  }

  const repeated = repeatedEvidenceDomain(input.reflection);
  if (repeated === "learning" && decisionSupportsDomain(input.decisionProfile, repeated)) {
    withFact(supportingFacts, recurringDomainFact(repeated, input.responseLanguage));
  }

  return Object.freeze({
    primaryFact,
    supportingFacts: Object.freeze(supportingFacts) as string[],
    safeSuggestion: count > 0
      ? input.responseLanguage === "de"
        ? "Du kannst mit dem zuletzt aktiven Lerneintrag weitermachen."
        : input.responseLanguage === "fa"
          ? "\u0645\u06cc\u062a\u0648\u0627\u0646\u06cc \u0645\u0648\u0631\u062f \u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc \u0627\u062e\u06cc\u0631 \u0631\u0627 \u0627\u062f\u0627\u0645\u0647 \u0628\u062f\u0647\u06cc."
          : "You can continue the most recent learning item."
      : undefined,
    evidenceDomains: Object.freeze(["learning"]) as WorkspaceSignalDomain[],
    confidence: confidence(Boolean(primaryFact), supportingFacts, false),
    synthesisVersion: CONTEXT_SYNTHESIS_VERSION,
  });
}

function synthesizeWorkspace(input: ContextSynthesisInput): SynthesizedContext {
  const context = input.workspaceContext ?? {};
  const primaryFact = workspaceGoalFact(
    context.currentGoalTitle,
    context.currentPrimaryDomain,
    input.responseLanguage,
  );
  const evidenceDomains = context.currentPrimaryDomain ? [context.currentPrimaryDomain] : [];

  return Object.freeze({
    primaryFact,
    supportingFacts: Object.freeze([]) as string[],
    evidenceDomains: Object.freeze(evidenceDomains) as WorkspaceSignalDomain[],
    confidence: primaryFact ? "medium" : "low",
    synthesisVersion: CONTEXT_SYNTHESIS_VERSION,
  });
}

function synthesizeGitHub(input: ContextSynthesisInput): SynthesizedContext {
  const primaryFact = cleanText(input.safeRuntimeSummary);
  return Object.freeze({
    primaryFact: primaryFact || undefined,
    supportingFacts: Object.freeze([]) as string[],
    evidenceDomains: Object.freeze(["github"]) as ContextSynthesisEvidenceDomain[],
    confidence: primaryFact ? "medium" : "low",
    synthesisVersion: CONTEXT_SYNTHESIS_VERSION,
  });
}

export function synthesizeContext(input: ContextSynthesisInput): SynthesizedContext {
  if (!SUPPORTED_TOOL_IDS.has(input.toolId ?? "")) return emptyResult("low");
  if (input.executionStatus !== "success") return emptyResult("low");

  switch (input.toolId) {
    case "tasks.list":
      return synthesizeTasks(input);
    case "calendar.list_today":
      return synthesizeCalendar(input);
    case "learning.get_progress":
      return synthesizeLearning(input);
    case "workspace.get_context":
      return synthesizeWorkspace(input);
    case "github.repositories.list":
    case "github.issues.list":
    case "github.pulls.list":
    case "github.workflow_runs.list":
      return synthesizeGitHub(input);
    default:
      return emptyResult("low");
  }
}
