// CORE-W3 (2026-09-06, CORE audit item ۱-۱): browser client for the
// Worker's POST /journal/assistant route. Forwards the signed-in user's
// own session token -- never a service-role key -- mirroring
// personalMemoryExtractionTriggerClient.ts's pattern.
import { supabase } from "@/integrations/supabase/client";
import type { JournalAiNote } from "./journalAiNotesService";

const WORKER_URL = (import.meta.env.VITE_AGENT_WORKER_URL as string | undefined) ?? "";

export type JournalAssistantErrorCode =
  | "UNAUTHENTICATED"
  | "CONFIGURATION_MISSING"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REQUEST_REJECTED"
  | "MODEL_OUTPUT_UNUSABLE"
  | "NETWORK_UNREACHABLE"
  | "REQUEST_FAILED";

export type JournalAssistantResult =
  | { ok: true; note: JournalAiNote; persisted: boolean }
  | { ok: false; code: JournalAssistantErrorCode; message: string };

export async function runJournalInstruction(
  instruction: string,
  entryDate: string,
  entryContent: string,
): Promise<JournalAssistantResult> {
  if (!WORKER_URL) {
    return { ok: false, code: "CONFIGURATION_MISSING", message: "The assistant endpoint is not configured in this environment." };
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { ok: false, code: "UNAUTHENTICATED", message: "Sign in again to use the journal assistant." };
  }

  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}/journal/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ instruction, entryDate, entryContent }),
    });
  } catch {
    return { ok: false, code: "NETWORK_UNREACHABLE", message: "The assistant service could not be reached." };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const code = ((body as { error?: { code?: string } })?.error?.code ?? "REQUEST_FAILED") as JournalAssistantErrorCode;
    const message = (body as { error?: { message?: string } })?.error?.message ?? "Something went wrong.";
    const known: JournalAssistantErrorCode[] = [
      "UNAUTHENTICATED", "PROVIDER_UNAVAILABLE", "PROVIDER_REQUEST_REJECTED", "MODEL_OUTPUT_UNUSABLE", "REQUEST_FAILED",
    ];
    return { ok: false, code: known.includes(code) ? code : "REQUEST_FAILED", message };
  }

  const payload = body as { note?: { id: string | null; instruction: string; reply: string; createdAt: string | null }; persisted?: boolean } | null;
  if (!payload?.note?.reply) {
    return { ok: false, code: "REQUEST_FAILED", message: "The assistant returned an unexpected response." };
  }
  return {
    ok: true,
    persisted: payload.persisted !== false && payload.note.id !== null,
    note: {
      id: payload.note.id ?? `unsaved-${Date.now()}`,
      instruction: payload.note.instruction,
      reply: payload.note.reply,
      createdAt: payload.note.createdAt ?? new Date().toISOString(),
    },
  };
}
