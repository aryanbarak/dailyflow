import { storageKey } from "@/lib/storage";
import type { Language } from "@/features/settings/appearanceStore";

export type SupportedAiResponseLanguage = "en" | "de" | "fa";
export type AiResponseLanguage = "auto" | SupportedAiResponseLanguage;
export type ResponseDirection = "ltr" | "rtl";

export interface ResolveAiResponseLanguageInput {
  configuredResponseLanguage?: string | null;
  latestUserMessage?: string | null;
  interfaceLanguage?: string | null;
}

export const AI_DEFAULTS_STORAGE_KEY = storageKey("ai-defaults");

const SUPPORTED_LANGUAGES: readonly SupportedAiResponseLanguage[] = ["en", "de", "fa"];
const SUPPORTED_RESPONSE_SETTINGS: readonly AiResponseLanguage[] = ["auto", ...SUPPORTED_LANGUAGES];

const GERMAN_MARKERS = new Set([
  "aber",
  "als",
  "auf",
  "aufgabe",
  "bitte",
  "das",
  "dein",
  "deine",
  "deutsch",
  "die",
  "dies",
  "du",
  "eine",
  "einen",
  "erkläre",
  "fuer",
  "für",
  "heute",
  "ich",
  "kannst",
  "kalender",
  "lernen",
  "mein",
  "meine",
  "meinen",
  "mit",
  "morgen",
  "nicht",
  "oder",
  "planen",
  "soll",
  "setze",
  "termin",
  "termine",
  "und",
  "was",
  "welche",
  "wie",
  "wir",
  "zeig",
  "zeige",
  "zusammenfassung",
]);

const ENGLISH_MARKERS = new Set([
  "about",
  "and",
  "can",
  "could",
  "document",
  "explain",
  "finance",
  "help",
  "how",
  "learn",
  "please",
  "review",
  "schedule",
  "should",
  "study",
  "task",
  "tasks",
  "the",
  "today",
  "tomorrow",
  "what",
  "why",
  "with",
]);

function isSupportedLanguage(value: unknown): value is SupportedAiResponseLanguage {
  return typeof value === "string" && SUPPORTED_LANGUAGES.includes(value as SupportedAiResponseLanguage);
}

export function normalizeAiResponseLanguage(value: unknown): AiResponseLanguage {
  return typeof value === "string" && SUPPORTED_RESPONSE_SETTINGS.includes(value as AiResponseLanguage)
    ? value as AiResponseLanguage
    : "auto";
}

export function getStoredAiResponseLanguage(storage: Storage | undefined = globalThis.localStorage): AiResponseLanguage {
  if (!storage) return "auto";
  try {
    const raw = storage.getItem(AI_DEFAULTS_STORAGE_KEY);
    if (!raw) return "auto";
    const parsed = JSON.parse(raw) as { aiResponseLanguage?: unknown; language?: unknown };
    return normalizeAiResponseLanguage(parsed.aiResponseLanguage ?? parsed.language);
  } catch {
    return "auto";
  }
}

function stripTechnicalNoise(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, " ")
    .replace(/\b[\w-]+\.[a-z]{2,}\b/gi, " ")
    .replace(/["'“”‘’][^"'“”‘’]{1,80}["'“”‘’]/g, " ");
}

export function detectAiResponseLanguage(message: string): SupportedAiResponseLanguage | null {
  const cleaned = stripTechnicalNoise(message).trim();
  if (!cleaned) return null;

  const persianChars = cleaned.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const latinChars = cleaned.match(/[A-Za-zÄÖÜäöüß]/g)?.length ?? 0;

  if (persianChars >= 3 && persianChars >= Math.max(3, latinChars * 0.18)) {
    return "fa";
  }

  const tokens: string[] = cleaned
    .toLowerCase()
    .match(/[a-zäöüß]+/g) ?? [];

  if (tokens.length === 0) return null;

  const germanDiacritics = cleaned.match(/[ÄÖÜäöüß]/g)?.length ?? 0;
  const germanScore = tokens.reduce((score, token) => score + (GERMAN_MARKERS.has(token) ? 1 : 0), germanDiacritics * 2);
  const englishScore = tokens.reduce((score, token) => score + (ENGLISH_MARKERS.has(token) ? 1 : 0), 0);

  if (germanScore >= 2 && germanScore > englishScore) return "de";
  if (englishScore >= 2 && englishScore >= germanScore) return "en";
  if (tokens.length >= 4 && germanScore === 0) return "en";

  return null;
}

export function resolveAiResponseLanguage(input: ResolveAiResponseLanguageInput): SupportedAiResponseLanguage {
  const configured = normalizeAiResponseLanguage(input.configuredResponseLanguage);
  if (isSupportedLanguage(configured)) return configured;

  const detected = detectAiResponseLanguage(input.latestUserMessage ?? "");
  if (detected) return detected;

  if (isSupportedLanguage(input.interfaceLanguage)) return input.interfaceLanguage;

  return "en";
}

export function getAiResponseDirection(language: SupportedAiResponseLanguage): ResponseDirection {
  return language === "fa" ? "rtl" : "ltr";
}

export function getAiResponseLanguageInstruction(language: SupportedAiResponseLanguage): string {
  if (language === "fa") {
    return [
      "\u0628\u0647 \u0632\u0628\u0627\u0646 \u0641\u0627\u0631\u0633\u06cc \u067e\u0627\u0633\u062e \u0628\u062f\u0647.",
      "Preserve code, product names, task titles, URLs, and technical identifiers as needed.",
      "You can communicate in English, German, and Persian.",
      "Do not change the application's interface language; this instruction applies only to AI-generated content.",
    ].join(" ");
  }

  const responseLine: Record<SupportedAiResponseLanguage, string> = {
    en: "Respond in English.",
    de: "Antworte auf Deutsch.",
    fa: "به زبان فارسی پاسخ بده.",
  };

  return [
    responseLine[language],
    "Preserve code, product names, task titles, URLs, and technical identifiers as needed.",
    "You can communicate in English, German, and Persian.",
    "Do not change the application's interface language; this instruction applies only to AI-generated content.",
  ].join(" ");
}

export function withAiResponseLanguageInstruction(message: string, language: SupportedAiResponseLanguage): string {
  return `${getAiResponseLanguageInstruction(language)}\n\n${message}`;
}

export function isInterfaceLanguage(value: string): value is Language {
  return isSupportedLanguage(value);
}
