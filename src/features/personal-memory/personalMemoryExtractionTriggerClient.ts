// SmartFlow -- Personal Memory Layer (ADR-0010), confirm/correct/reject/
// delete UI (task 6). Browser-side client for the Worker's authenticated
// POST /personal-memory/extraction route
// (agent/worker/personal-memory-extraction-endpoint.ts). Forwards the
// signed-in user's own session token -- never a service-role key --
// mirroring contextDerivationTriggerClient.ts's identical pattern one
// dimension over.

import { supabase } from "@/integrations/supabase/client";

const WORKER_URL = (import.meta.env.VITE_AGENT_WORKER_URL as string | undefined) ?? "";

export type PersonalMemoryExtractionTriggerErrorCode =
  | "UNAUTHENTICATED"
  | "CONFIGURATION_MISSING"
  | "NO_SOURCE_MATERIAL"
  | "REQUEST_FAILED";

export interface PersonalMemoryExtractionTriggerSuccess {
  readonly ok: true;
  readonly runId: string;
  readonly sourceItemCount: number;
  readonly candidateCount: number;
  readonly acceptedCount: number;
  readonly droppedCount: number;
}

export interface PersonalMemoryExtractionTriggerFailure {
  readonly ok: false;
  readonly code: PersonalMemoryExtractionTriggerErrorCode;
  readonly message: string;
}

export type PersonalMemoryExtractionTriggerResult = PersonalMemoryExtractionTriggerSuccess | PersonalMemoryExtractionTriggerFailure;

const WORKER_ERROR_CODE_MAP: Record<string, PersonalMemoryExtractionTriggerErrorCode | undefined> = {
  UNAUTHORIZED: "UNAUTHENTICATED",
  CONFIGURATION_MISSING: "CONFIGURATION_MISSING",
  NO_SOURCE_MATERIAL: "NO_SOURCE_MATERIAL",
};

export interface PersonalMemoryExtractionTriggerDependencies {
  fetcher?: typeof fetch;
  getSessionToken?: () => Promise<string | null>;
}

async function defaultGetSessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function triggerPersonalMemoryExtraction(
  dependencies: PersonalMemoryExtractionTriggerDependencies = {},
): Promise<PersonalMemoryExtractionTriggerResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const getSessionToken = dependencies.getSessionToken ?? defaultGetSessionToken;

  if (!WORKER_URL) {
    return { ok: false, code: "CONFIGURATION_MISSING", message: "The agent worker URL is not configured." };
  }

  const token = await getSessionToken();
  if (!token) {
    return { ok: false, code: "UNAUTHENTICATED", message: "Sign in to check for new personal memory." };
  }

  let response: Response;
  try {
    response = await fetcher(`${WORKER_URL}/personal-memory/extraction`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
  } catch {
    return { ok: false, code: "REQUEST_FAILED", message: "Could not reach the personal memory extraction service." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "REQUEST_FAILED", message: "The personal memory extraction service returned an unreadable response." };
  }

  if (!response.ok) {
    const errorBody = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const rawCode = typeof errorBody?.code === "string" ? errorBody.code : "";
    const message = typeof errorBody?.message === "string" ? errorBody.message : "Personal memory extraction failed.";
    return { ok: false, code: WORKER_ERROR_CODE_MAP[rawCode] ?? "REQUEST_FAILED", message };
  }

  const result = body as {
    runId?: unknown;
    sourceItemCount?: unknown;
    candidateCount?: unknown;
    acceptedCount?: unknown;
    droppedCount?: unknown;
  };
  if (typeof result.runId !== "string") {
    return { ok: false, code: "REQUEST_FAILED", message: "The personal memory extraction service returned an incomplete result." };
  }

  return {
    ok: true,
    runId: result.runId,
    sourceItemCount: typeof result.sourceItemCount === "number" ? result.sourceItemCount : 0,
    candidateCount: typeof result.candidateCount === "number" ? result.candidateCount : 0,
    acceptedCount: typeof result.acceptedCount === "number" ? result.acceptedCount : 0,
    droppedCount: typeof result.droppedCount === "number" ? result.droppedCount : 0,
  };
}
