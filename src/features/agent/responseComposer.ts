import type { AgentReflectionResult } from "./reflectionTypes";
import type { SynthesizedContext } from "./contextSynthesis";
import type { WorkspaceDecisionProfile } from "../workspace/workspaceTypes";
import { GITHUB_NOT_CONNECTED_SUMMARY } from "./readOnlyResultPresenter";

export const RESPONSE_COMPOSER_VERSION = "response-composer-v1" as const;

export const SUPPORTED_RESPONSE_COMPOSER_TOOL_IDS = Object.freeze([
  "tasks.list",
  "calendar.list_today",
  "learning.get_progress",
  "workspace.get_context",
  "tasks.complete",
  "github.repositories.list",
  "github.issues.list",
  "github.pulls.list",
  "github.workflow_runs.list",
] as const);

export type ResponseComposerToolId = typeof SUPPORTED_RESPONSE_COMPOSER_TOOL_IDS[number];
export type AssistantResponseLanguage = "en" | "de" | "fa";

export interface ResponseComposerInput {
  toolId?: string;
  language: AssistantResponseLanguage;
  success: boolean;
  safeSummary: string;
  safePreviewItems?: readonly string[];
  reflection?: AgentReflectionResult;
  decisionProfile?: WorkspaceDecisionProfile;
  synthesizedContext?: SynthesizedContext;
}

export interface AssistantResponse {
  headline: string;
  summary: string;
  details: string[];
  optionalSuggestion?: string;
  language: AssistantResponseLanguage;
  styleVersion: typeof RESPONSE_COMPOSER_VERSION;
}

type ComposerCopy = {
  headline: string;
  emptySummary: string;
  countSummary(count: number): string;
  completionSummary?: string;
  alreadyCompletedSummary?: string;
  failureSummary: string;
  suggestion?: string;
};

const TOOL_COPY: Record<ResponseComposerToolId, Record<AssistantResponseLanguage, ComposerCopy>> = {
  "tasks.list": {
    en: {
      headline: "Here is your task overview.",
      emptySummary: "You do not have active tasks right now.",
      countSummary: (count) => `You currently have ${count} active ${count === 1 ? "task" : "tasks"}.`,
      failureSummary: "I could not load your task overview safely.",
      suggestion: "Choose one active task to move forward.",
    },
    de: {
      headline: "Hier ist deine Aufgabenubersicht.",
      emptySummary: "Du hast im Moment keine aktiven Aufgaben.",
      countSummary: (count) => `Du hast aktuell ${count} aktive ${count === 1 ? "Aufgabe" : "Aufgaben"}.`,
      failureSummary: "Ich konnte deine Aufgabenubersicht nicht sicher laden.",
      suggestion: "Wahle eine aktive Aufgabe als nachsten Schritt.",
    },
    fa: {
      headline: "\u0646\u0645\u0627\u06cc \u06a9\u0644\u06cc \u06a9\u0627\u0631\u0647\u0627\u06cc\u062a \u0627\u06cc\u0646 \u0627\u0633\u062a.",
      emptySummary: "\u0627\u06a9\u0646\u0648\u0646 \u06a9\u0627\u0631 \u0641\u0639\u0627\u0644\u06cc \u0646\u062f\u0627\u0631\u06cc.",
      countSummary: (count) => `\u0627\u06a9\u0646\u0648\u0646 ${count} \u06a9\u0627\u0631 \u0641\u0639\u0627\u0644 \u062f\u0627\u0631\u06cc.`,
      failureSummary: "\u0646\u062a\u0648\u0627\u0646\u0633\u062a\u0645 \u0646\u0645\u0627\u06cc \u06a9\u0627\u0631\u0647\u0627\u06cc\u062a \u0631\u0627 \u0628\u0647 \u0634\u06a9\u0644 \u0627\u0645\u0646 \u0628\u06cc\u0627\u0648\u0631\u0645.",
      suggestion: "\u06cc\u06a9 \u06a9\u0627\u0631 \u0641\u0639\u0627\u0644 \u0631\u0627 \u0628\u0631\u0627\u06cc \u0634\u0631\u0648\u0639 \u0627\u0646\u062a\u062e\u0627\u0628 \u06a9\u0646.",
    },
  },
  "calendar.list_today": {
    en: {
      headline: "Here is today's calendar.",
      emptySummary: "Your calendar is clear today.",
      countSummary: (count) => `You have ${count} ${count === 1 ? "event" : "events"} today.`,
      failureSummary: "I could not load today's calendar safely.",
      suggestion: "Use the open space for focused work.",
    },
    de: {
      headline: "Hier ist dein Kalender fur heute.",
      emptySummary: "Dein Kalender ist heute frei.",
      countSummary: (count) => `Du hast heute ${count} ${count === 1 ? "Termin" : "Termine"}.`,
      failureSummary: "Ich konnte deinen Kalender fur heute nicht sicher laden.",
      suggestion: "Nutze den freien Raum fur konzentrierte Arbeit.",
    },
    fa: {
      headline: "\u062a\u0642\u0648\u06cc\u0645 \u0627\u0645\u0631\u0648\u0632\u062a \u0627\u06cc\u0646 \u0627\u0633\u062a.",
      emptySummary: "\u062a\u0642\u0648\u06cc\u0645\u062a \u0627\u0645\u0631\u0648\u0632 \u062e\u0627\u0644\u06cc \u0627\u0633\u062a.",
      countSummary: (count) => `\u0627\u0645\u0631\u0648\u0632 ${count} \u0631\u0648\u06cc\u062f\u0627\u062f \u062f\u0627\u0631\u06cc.`,
      failureSummary: "\u0646\u062a\u0648\u0627\u0646\u0633\u062a\u0645 \u062a\u0642\u0648\u06cc\u0645 \u0627\u0645\u0631\u0648\u0632\u062a \u0631\u0627 \u0628\u0647 \u0634\u06a9\u0644 \u0627\u0645\u0646 \u0628\u06cc\u0627\u0648\u0631\u0645.",
      suggestion: "\u0627\u06cc\u0646 \u0641\u0636\u0627\u06cc \u062e\u0627\u0644\u06cc \u0631\u0627 \u0628\u0631\u0627\u06cc \u06a9\u0627\u0631 \u0645\u062a\u0645\u0631\u06a9\u0632 \u0627\u0633\u062a\u0641\u0627\u062f\u0647 \u06a9\u0646.",
    },
  },
  "learning.get_progress": {
    en: {
      headline: "Here is your learning progress.",
      emptySummary: "I do not see learning progress yet.",
      countSummary: (count) => `I found ${count} learning ${count === 1 ? "item" : "items"}.`,
      failureSummary: "I could not load your learning progress safely.",
      suggestion: "Continue with the item that feels closest to your current goal.",
    },
    de: {
      headline: "Hier ist dein Lernfortschritt.",
      emptySummary: "Ich sehe noch keinen Lernfortschritt.",
      countSummary: (count) => `Ich habe ${count} ${count === 1 ? "Lerneintrag" : "Lerneintrage"} gefunden.`,
      failureSummary: "Ich konnte deinen Lernfortschritt nicht sicher laden.",
      suggestion: "Mach mit dem Thema weiter, das deinem aktuellen Ziel am nachsten ist.",
    },
    fa: {
      headline: "\u067e\u06cc\u0634\u0631\u0641\u062a \u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc\u0627\u062a \u0627\u06cc\u0646 \u0627\u0633\u062a.",
      emptySummary: "\u0647\u0646\u0648\u0632 \u067e\u06cc\u0634\u0631\u0641\u062a \u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc \u0646\u0645\u06cc\u0628\u06cc\u0646\u0645.",
      countSummary: (count) => `${count} \u0645\u0648\u0631\u062f \u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc \u067e\u06cc\u062f\u0627 \u06a9\u0631\u062f\u0645.`,
      failureSummary: "\u0646\u062a\u0648\u0627\u0646\u0633\u062a\u0645 \u067e\u06cc\u0634\u0631\u0641\u062a \u06cc\u0627\u062f\u06af\u06cc\u0631\u06cc\u0627\u062a \u0631\u0627 \u0628\u0647 \u0634\u06a9\u0644 \u0627\u0645\u0646 \u0628\u06cc\u0627\u0648\u0631\u0645.",
      suggestion: "\u0628\u0627 \u0646\u0632\u062f\u06cc\u06a9\u062a\u0631\u06cc\u0646 \u0645\u0648\u0636\u0648\u0639 \u0628\u0647 \u0647\u062f\u0641 \u0641\u0639\u0644\u06cc\u0627\u062a \u0627\u062f\u0627\u0645\u0647 \u0628\u062f\u0647.",
    },
  },
  "workspace.get_context": {
    en: {
      headline: "Here is the workspace context I verified.",
      emptySummary: "Your workspace context is available.",
      countSummary: () => "Your workspace context is available.",
      failureSummary: "I could not load the workspace context safely.",
      suggestion: "Use this context to choose the next focused step.",
    },
    de: {
      headline: "Hier ist der geprufte Workspace-Kontext.",
      emptySummary: "Dein Workspace-Kontext ist verfugbar.",
      countSummary: () => "Dein Workspace-Kontext ist verfugbar.",
      failureSummary: "Ich konnte den Workspace-Kontext nicht sicher laden.",
      suggestion: "Nutze diesen Kontext, um den nachsten fokussierten Schritt zu wahlen.",
    },
    fa: {
      headline: "\u0627\u06cc\u0646 \u0632\u0645\u06cc\u0646\u0647 \u062a\u0627\u06cc\u06cc\u062f\u0634\u062f\u0647 \u0648\u0631\u06a9\u0633\u067e\u06cc\u0633 \u0627\u0633\u062a.",
      emptySummary: "\u0632\u0645\u06cc\u0646\u0647 \u0648\u0631\u06a9\u0633\u067e\u06cc\u0633\u062a \u0622\u0645\u0627\u062f\u0647 \u0627\u0633\u062a.",
      countSummary: () => "\u0632\u0645\u06cc\u0646\u0647 \u0648\u0631\u06a9\u0633\u067e\u06cc\u0633\u062a \u0622\u0645\u0627\u062f\u0647 \u0627\u0633\u062a.",
      failureSummary: "\u0646\u062a\u0648\u0627\u0646\u0633\u062a\u0645 \u0632\u0645\u06cc\u0646\u0647 \u0648\u0631\u06a9\u0633\u067e\u06cc\u0633 \u0631\u0627 \u0628\u0647 \u0634\u06a9\u0644 \u0627\u0645\u0646 \u0628\u06cc\u0627\u0648\u0631\u0645.",
      suggestion: "\u0627\u0632 \u0627\u06cc\u0646 \u0632\u0645\u06cc\u0646\u0647 \u0628\u0631\u0627\u06cc \u0627\u0646\u062a\u062e\u0627\u0628 \u0642\u062f\u0645 \u0628\u0639\u062f\u06cc \u0627\u0633\u062a\u0641\u0627\u062f\u0647 \u06a9\u0646.",
    },
  },
  "github.repositories.list": {
    en: {
      headline: "Here are your connected GitHub repositories.",
      emptySummary: "GitHub is not connected or no repositories are available.",
      countSummary: (count) => `I found ${count} connected GitHub ${count === 1 ? "repository" : "repositories"}.`,
      failureSummary: "I could not load your connected GitHub repositories safely.",
      suggestion: "Open GitHub settings separately if you need to change repository access.",
    },
    de: {
      headline: "Hier sind deine verbundenen GitHub-Repositories.",
      emptySummary: "GitHub ist nicht verbunden oder es sind keine Repositories verfuegbar.",
      countSummary: (count) => `Ich habe ${count} verbundene GitHub-${count === 1 ? "Repository" : "Repositories"} gefunden.`,
      failureSummary: "Ich konnte deine verbundenen GitHub-Repositories nicht sicher laden.",
      suggestion: "Aendere den Repository-Zugriff bei Bedarf separat in den GitHub-Einstellungen.",
    },
    fa: {
      headline: "مخزن‌های متصل گیت‌هاب تو این‌ها هستند.",
      emptySummary: "گیت‌هاب متصل نیست یا مخزنی در دسترس نیست.",
      countSummary: (count) => `${count} مخزن متصل گیت‌هاب پیدا کردم.`,
      failureSummary: "نتوانستم مخزن‌های متصل گیت‌هاب را به شکل امن بارگذاری کنم.",
      suggestion: "برای تغییر دسترسی مخزن‌ها، تنظیمات گیت‌هاب را جداگانه باز کن.",
    },
  },
  "github.issues.list": {
    en: {
      headline: "Here are your open GitHub issues.",
      emptySummary: "GitHub is not connected or no open issues are available.",
      countSummary: (count) => `I found ${count} open GitHub ${count === 1 ? "issue" : "issues"}.`,
      failureSummary: "I could not load your open GitHub issues safely.",
      suggestion: "Open GitHub separately if you need to change or comment on an issue.",
    },
    de: {
      headline: "Hier sind deine offenen GitHub-Issues.",
      emptySummary: "GitHub ist nicht verbunden oder es sind keine offenen Issues verfuegbar.",
      countSummary: (count) => `Ich habe ${count} offene GitHub-${count === 1 ? "Issue" : "Issues"} gefunden.`,
      failureSummary: "Ich konnte deine offenen GitHub-Issues nicht sicher laden.",
      suggestion: "Oeffne GitHub separat, wenn du ein Issue aendern oder kommentieren moechtest.",
    },
    fa: {
      headline: "ایشوهای باز گیت‌هاب تو این‌ها هستند.",
      emptySummary: "گیت‌هاب متصل نیست یا ایشوی بازی در دسترس نیست.",
      countSummary: (count) => `${count} ایشوی باز گیت‌هاب پیدا کردم.`,
      failureSummary: "نتوانستم ایشوهای باز گیت‌هاب را به شکل امن بارگذاری کنم.",
      suggestion: "برای تغییر یا نظر دادن روی یک ایشو، گیت‌هاب را جداگانه باز کن.",
    },
  },
  "github.pulls.list": {
    en: {
      headline: "Here are your open GitHub pull requests.",
      emptySummary: "GitHub is not connected or no open pull requests are available.",
      countSummary: (count) => `I found ${count} open GitHub pull ${count === 1 ? "request" : "requests"}.`,
      failureSummary: "I could not load your open GitHub pull requests safely.",
      suggestion: "Open GitHub separately if you need to review or merge a pull request.",
    },
    de: {
      headline: "Hier sind deine offenen GitHub-Pull-Requests.",
      emptySummary: "GitHub ist nicht verbunden oder es sind keine offenen Pull-Requests verfuegbar.",
      countSummary: (count) => `Ich habe ${count} offene GitHub-Pull-${count === 1 ? "Request" : "Requests"} gefunden.`,
      failureSummary: "Ich konnte deine offenen GitHub-Pull-Requests nicht sicher laden.",
      suggestion: "Oeffne GitHub separat, wenn du einen Pull-Request pruefen oder mergen moechtest.",
    },
    fa: {
      headline: "پول‌ریکوئست‌های باز گیت‌هاب تو این‌ها هستند.",
      emptySummary: "گیت‌هاب متصل نیست یا پول‌ریکوئست بازی در دسترس نیست.",
      countSummary: (count) => `${count} پول‌ریکوئست باز گیت‌هاب پیدا کردم.`,
      failureSummary: "نتوانستم پول‌ریکوئست‌های باز گیت‌هاب را به شکل امن بارگذاری کنم.",
      suggestion: "برای بررسی یا ادغام یک پول‌ریکوئست، گیت‌هاب را جداگانه باز کن.",
    },
  },
  "github.workflow_runs.list": {
    en: {
      headline: "Here are your recent GitHub workflow runs.",
      emptySummary: "GitHub is not connected or no recent workflow runs are available.",
      countSummary: (count) => `I found ${count} recent GitHub workflow ${count === 1 ? "run" : "runs"}.`,
      failureSummary: "I could not load your recent GitHub workflow runs safely.",
      suggestion: "Open GitHub Actions separately if you need run logs or details.",
    },
    de: {
      headline: "Hier sind deine letzten GitHub-Workflow-Laeufe.",
      emptySummary: "GitHub ist nicht verbunden oder es sind keine letzten Workflow-Laeufe verfuegbar.",
      countSummary: (count) => `Ich habe ${count} letzte GitHub-Workflow-${count === 1 ? "Lauf" : "Laeufe"} gefunden.`,
      failureSummary: "Ich konnte deine letzten GitHub-Workflow-Laeufe nicht sicher laden.",
      suggestion: "Oeffne GitHub Actions separat, wenn du Protokolle oder Details brauchst.",
    },
    fa: {
      headline: "اجراهای اخیر ورک‌فلوهای گیت‌هاب تو این‌ها هستند.",
      emptySummary: "گیت‌هاب متصل نیست یا اجرای اخیری در دسترس نیست.",
      countSummary: (count) => `${count} اجرای اخیر ورک‌فلو گیت‌هاب پیدا کردم.`,
      failureSummary: "نتوانستم اجراهای اخیر ورک‌فلوهای گیت‌هاب را به شکل امن بارگذاری کنم.",
      suggestion: "برای دیدن جزئیات یا لاگ‌ها، گیت‌هاب اکشنز را جداگانه باز کن.",
    },
  },
  "tasks.complete": {
    en: {
      headline: "The task update is complete.",
      emptySummary: "The task is marked complete.",
      countSummary: () => "The task is marked complete.",
      completionSummary: "The task is marked complete.",
      alreadyCompletedSummary: "The task was already complete, so I did not change it again.",
      failureSummary: "I could not verify the task completion safely.",
      suggestion: "You can continue with the next task when ready.",
    },
    de: {
      headline: "Die Aufgabenaktualisierung ist abgeschlossen.",
      emptySummary: "Die Aufgabe ist als erledigt markiert.",
      countSummary: () => "Die Aufgabe ist als erledigt markiert.",
      completionSummary: "Die Aufgabe ist als erledigt markiert.",
      alreadyCompletedSummary: "Die Aufgabe war bereits erledigt, daher habe ich sie nicht erneut geandert.",
      failureSummary: "Ich konnte die Aufgabenerledigung nicht sicher bestatigen.",
      suggestion: "Du kannst mit der nachsten Aufgabe weitermachen, wenn du bereit bist.",
    },
    fa: {
      headline: "\u0628\u0647\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc \u06a9\u0627\u0631 \u0627\u0646\u062c\u0627\u0645 \u0634\u062f.",
      emptySummary: "\u0627\u06cc\u0646 \u06a9\u0627\u0631 \u0628\u0647 \u0639\u0646\u0648\u0627\u0646 \u0627\u0646\u062c\u0627\u0645\u0634\u062f\u0647 \u062b\u0628\u062a \u0634\u062f.",
      countSummary: () => "\u0627\u06cc\u0646 \u06a9\u0627\u0631 \u0628\u0647 \u0639\u0646\u0648\u0627\u0646 \u0627\u0646\u062c\u0627\u0645\u0634\u062f\u0647 \u062b\u0628\u062a \u0634\u062f.",
      completionSummary: "\u0627\u06cc\u0646 \u06a9\u0627\u0631 \u0628\u0647 \u0639\u0646\u0648\u0627\u0646 \u0627\u0646\u062c\u0627\u0645\u0634\u062f\u0647 \u062b\u0628\u062a \u0634\u062f.",
      alreadyCompletedSummary: "\u0627\u06cc\u0646 \u06a9\u0627\u0631 \u0642\u0628\u0644\u0627 \u0627\u0646\u062c\u0627\u0645 \u0634\u062f\u0647 \u0628\u0648\u062f\u060c \u067e\u0633 \u062f\u0648\u0628\u0627\u0631\u0647 \u062a\u063a\u06cc\u06cc\u0631\u0634 \u0646\u062f\u0627\u062f\u0645.",
      failureSummary: "\u0646\u062a\u0648\u0627\u0646\u0633\u062a\u0645 \u0627\u0646\u062c\u0627\u0645 \u0634\u062f\u0646 \u06a9\u0627\u0631 \u0631\u0627 \u0628\u0647 \u0634\u06a9\u0644 \u0627\u0645\u0646 \u062a\u0627\u06cc\u06cc\u062f \u06a9\u0646\u0645.",
      suggestion: "\u0647\u0631 \u0648\u0642\u062a \u0622\u0645\u0627\u062f\u0647 \u0628\u0648\u062f\u06cc\u060c \u0645\u06cc\u062a\u0648\u0627\u0646\u06cc \u06a9\u0627\u0631 \u0628\u0639\u062f\u06cc \u0631\u0627 \u0627\u062f\u0627\u0645\u0647 \u0628\u062f\u0647\u06cc.",
    },
  },
};

const UNSUPPORTED_HEADLINE: Record<AssistantResponseLanguage, string> = {
  en: "The action completed safely.",
  de: "Die Aktion wurde sicher abgeschlossen.",
  fa: "\u0627\u0642\u062f\u0627\u0645 \u0628\u0647 \u0634\u06a9\u0644 \u0627\u0645\u0646 \u0627\u0646\u062c\u0627\u0645 \u0634\u062f.",
};

const LOW_DATA_NOTE: Record<AssistantResponseLanguage, string> = {
  en: "I am keeping the response compact while I learn more from your workspace.",
  de: "Ich halte die Antwort knapp, solange ich noch mehr aus deinem Workspace lerne.",
  fa: "\u062a\u0627 \u0648\u0642\u062a\u06cc \u0627\u0632 \u0648\u0631\u06a9\u0633\u067e\u06cc\u0633\u062a \u0628\u06cc\u0634\u062a\u0631 \u06cc\u0627\u062f \u0628\u06af\u06cc\u0631\u0645\u060c \u067e\u0627\u0633\u062e \u0631\u0627 \u06a9\u0648\u062a\u0627\u0647 \u0646\u06af\u0647 \u0645\u06cc\u062f\u0627\u0631\u0645.",
};

const INTERNAL_FIELD_PATTERN =
  /\b(requestId|stepId|taskId|schemaVersion|policyDecision|auditCorrelation|auditId|access_token|authorization|schema|confidence|score|scores)\b\s*[:=]?\s*[\w:./-]*/gi;
const INTERNAL_NAME_PATTERN =
  /\b(Reflection Engine|Decision Intelligence|Priority Engine|WorkspaceMemory|Memory Evidence|Execution Audit|Execution Policy|context-synthesis-v1|response-composer-v1)\b/gi;

export function canComposeAssistantResponse(toolId: string | undefined): toolId is ResponseComposerToolId {
  return SUPPORTED_RESPONSE_COMPOSER_TOOL_IDS.includes(toolId as ResponseComposerToolId);
}

function sanitizeText(value: string) {
  return value
    .replace(INTERNAL_FIELD_PATTERN, "")
    .replace(INTERNAL_NAME_PATTERN, "")
    .replace(/[{}[\]"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeItems(items: readonly string[] | undefined) {
  return (items ?? [])
    .map((item) => sanitizeText(item))
    .filter(Boolean)
    .slice(0, 6);
}

function countFromSummary(summary: string) {
  const match = summary.match(/\b(\d+)\b/);
  if (!match) return undefined;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : undefined;
}

function summaryFor(input: ResponseComposerInput, copy: ComposerCopy) {
  const safeSummary = sanitizeText(input.safeSummary);
  if (!input.success) return copy.failureSummary;

  if (input.toolId === "tasks.complete") {
    if (/already complete/i.test(input.safeSummary)) {
      return copy.alreadyCompletedSummary ?? copy.emptySummary;
    }
    return copy.completionSummary ?? copy.emptySummary;
  }

  const count = countFromSummary(safeSummary);
  if (typeof count === "number") {
    if (count === 0) return copy.emptySummary;
    return copy.countSummary(count);
  }

  // Task 33-fix, belt and braces: readOnlyResultPresenter.ts's raw data
  // (result.data.connectionStatus) is not available here -- by this point
  // it has already been collapsed into safeSummary/safePreviewItems -- so
  // this cannot check the not-connected condition itself. It checks the
  // exact shared constant instead of relying only on the /^no\s+/i prefix
  // below. That prefix check is the ONLY reason task 33's English leak
  // ("GitHub is not connected." rendering untranslated inside Farsi/German
  // replies) went unnoticed: it depends entirely on every non-numeric
  // safeSummary happening to be phrased "No X found", which is fragile,
  // undocumented English-prefix language detection, not a real check. This
  // explicit match doesn't fix that fragility -- it only hardens this one
  // known case. The general fragility is tracked as debt, not fixed here.
  if (input.safeSummary === GITHUB_NOT_CONNECTED_SUMMARY) return copy.emptySummary;

  if (/^no\s+/i.test(input.safeSummary)) return copy.emptySummary;
  return safeSummary || copy.emptySummary;
}

function suggestionFor(input: ResponseComposerInput, copy: ComposerCopy) {
  const synthesizedSuggestion = sanitizeText(input.synthesizedContext?.safeSuggestion ?? "");
  if (synthesizedSuggestion) return synthesizedSuggestion;
  if (
    input.synthesizedContext &&
    !input.synthesizedContext.primaryFact &&
    input.synthesizedContext.supportingFacts.length === 0 &&
    input.synthesizedContext.confidence === "low"
  ) {
    return undefined;
  }
  if (countFromSummary(sanitizeText(input.safeSummary)) === 0 || /^no\s+/i.test(input.safeSummary)) {
    return undefined;
  }
  const reflected = sanitizeText(input.reflection?.suggestedFollowUp ?? "");
  if (reflected) return reflected;
  if (input.decisionProfile?.lowData && input.success) return LOW_DATA_NOTE[input.language];
  return input.success ? copy.suggestion : undefined;
}

function detailsFor(input: ResponseComposerInput) {
  const synthesizedFacts = input.synthesizedContext?.supportingFacts ?? [];
  return [
    ...synthesizedFacts.map((fact) => sanitizeText(fact)),
    ...sanitizeItems(input.safePreviewItems),
  ].filter(Boolean).slice(0, 6);
}

function primarySummaryFor(input: ResponseComposerInput, copy: ComposerCopy) {
  const synthesizedPrimary = sanitizeText(input.synthesizedContext?.primaryFact ?? "");
  if (input.success && synthesizedPrimary) return synthesizedPrimary;
  return summaryFor(input, copy);
}

export function composeAssistantResponse(input: ResponseComposerInput): AssistantResponse {
  const language = input.language;
  const toolId = input.toolId;

  if (!canComposeAssistantResponse(toolId)) {
    return Object.freeze({
      headline: UNSUPPORTED_HEADLINE[language],
      summary: sanitizeText(input.safeSummary) || UNSUPPORTED_HEADLINE[language],
      details: [],
      language,
      styleVersion: RESPONSE_COMPOSER_VERSION,
    });
  }

  const copy = TOOL_COPY[toolId][language];
  return Object.freeze({
    headline: copy.headline,
    summary: primarySummaryFor(input, copy),
    details: Object.freeze(detailsFor(input)) as string[],
    optionalSuggestion: suggestionFor(input, copy),
    language,
    styleVersion: RESPONSE_COMPOSER_VERSION,
  });
}

export function formatAssistantResponse(response: AssistantResponse) {
  const parts = [`**${response.headline}**`, response.summary];

  if (response.details.length > 0) {
    parts.push(response.details.map((item) => `- ${item}`).join("\n"));
  }

  if (response.optionalSuggestion) {
    parts.push(response.optionalSuggestion);
  }

  return parts.filter(Boolean).join("\n\n");
}
