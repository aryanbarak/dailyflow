// CORE-W5 (2026-09-06, CORE audit item ۱-۴): browser client for the
// Worker's POST /schedule/parse route. Forwards the signed-in user's own
// session token -- never a service-role key -- mirroring
// journalAssistantClient.ts's pattern exactly.
import { supabase } from "@/integrations/supabase/client";
import type { TranslationKey } from "@/i18n";

const WORKER_URL = (import.meta.env.VITE_AGENT_WORKER_URL as string | undefined) ?? "";

export type ScheduleParseGranularity = "date" | "datetime";

export type ScheduleParseErrorCode =
  | "UNAUTHENTICATED"
  | "CONFIGURATION_MISSING"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REQUEST_REJECTED"
  | "MODEL_OUTPUT_UNUSABLE"
  | "NETWORK_UNREACHABLE"
  | "REQUEST_FAILED";

export interface ScheduleParseSuccess {
  ok: true;
  kind: "recurring" | "one_time" | "none";
  rrule?: string;
  startTime?: string;
  label: string;
}

export type ScheduleParseResult =
  | ScheduleParseSuccess
  | { ok: false; code: ScheduleParseErrorCode; message: string };

const ERROR_MESSAGE_KEYS: Record<Exclude<ScheduleParseErrorCode, "REQUEST_FAILED">, TranslationKey> = {
  UNAUTHENTICATED: "schedule_error_unauthenticated",
  CONFIGURATION_MISSING: "schedule_error_configuration_missing",
  PROVIDER_UNAVAILABLE: "schedule_error_provider_unavailable",
  PROVIDER_REQUEST_REJECTED: "schedule_error_request_failed",
  MODEL_OUTPUT_UNUSABLE: "schedule_error_unusable",
  NETWORK_UNREACHABLE: "schedule_error_network",
};

export async function parseScheduleText(
  text: string,
  granularity: ScheduleParseGranularity,
  lang: "en" | "de" | "fa",
): Promise<ScheduleParseResult> {
  if (!WORKER_URL) {
    return { ok: false, code: "CONFIGURATION_MISSING", message: "The scheduling assistant is not configured in this environment." };
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { ok: false, code: "UNAUTHENTICATED", message: "Sign in again to use the scheduling assistant." };
  }

  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}/schedule/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text,
        currentTime: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang,
        granularity,
      }),
    });
  } catch {
    return { ok: false, code: "NETWORK_UNREACHABLE", message: "The scheduling assistant could not be reached." };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const code = ((body as { error?: { code?: string } })?.error?.code ?? "REQUEST_FAILED") as ScheduleParseErrorCode;
    const message = (body as { error?: { message?: string } })?.error?.message ?? "Something went wrong.";
    const known: ScheduleParseErrorCode[] = [
      "UNAUTHENTICATED", "PROVIDER_UNAVAILABLE", "PROVIDER_REQUEST_REJECTED", "MODEL_OUTPUT_UNUSABLE", "REQUEST_FAILED",
    ];
    return { ok: false, code: known.includes(code) ? code : "REQUEST_FAILED", message };
  }

  const payload = body as { result?: { kind?: string; rrule?: string; startTime?: string; label?: string } } | null;
  const result = payload?.result;
  if (!result || (result.kind !== "recurring" && result.kind !== "one_time" && result.kind !== "none") || typeof result.label !== "string") {
    return { ok: false, code: "REQUEST_FAILED", message: "The assistant returned an unexpected response." };
  }
  return { ok: true, kind: result.kind, rrule: result.rrule, startTime: result.startTime, label: result.label };
}

/** Looks up a translated error message for a failed parse, falling back to the server's own message for REQUEST_FAILED. */
export function scheduleErrorMessageKey(code: ScheduleParseErrorCode): TranslationKey | null {
  return code === "REQUEST_FAILED" ? null : ERROR_MESSAGE_KEYS[code];
}
