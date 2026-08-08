// SmartFlow -- Inferred Project Context Layer (ADR-0009), confirm/correct UI
// (task 4). Browser-side client for the Worker's authenticated
// POST /projects/context-derivation route
// (agent/worker/context-derivation-endpoint.ts). Forwards the signed-in
// user's own session token -- never a service-role key -- exactly the
// pattern documentAiService.ts's getAuthHeaders() already uses for another
// authenticated Worker route.

import { supabase } from "@/integrations/supabase/client";

const WORKER_URL = (import.meta.env.VITE_AGENT_WORKER_URL as string | undefined) ?? "";

export type ContextDerivationTriggerErrorCode =
  | "UNAUTHENTICATED"
  | "CONFIGURATION_MISSING"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ARCHIVED"
  | "NO_ELIGIBLE_EVIDENCE"
  | "REQUEST_FAILED";

export interface ContextDerivationTriggerSuccess {
  readonly ok: true;
  readonly runId: string;
  readonly evidenceCount: number;
  readonly candidateCount: number;
  readonly acceptedCount: number;
  readonly droppedCount: number;
}

export interface ContextDerivationTriggerFailure {
  readonly ok: false;
  readonly code: ContextDerivationTriggerErrorCode;
  readonly message: string;
}

export type ContextDerivationTriggerResult = ContextDerivationTriggerSuccess | ContextDerivationTriggerFailure;

const WORKER_ERROR_CODE_MAP: Record<string, ContextDerivationTriggerErrorCode | undefined> = {
  UNAUTHORIZED: "UNAUTHENTICATED",
  CONFIGURATION_MISSING: "CONFIGURATION_MISSING",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  PROJECT_ARCHIVED: "PROJECT_ARCHIVED",
  NO_ELIGIBLE_EVIDENCE: "NO_ELIGIBLE_EVIDENCE",
};

export interface ContextDerivationTriggerDependencies {
  fetcher?: typeof fetch;
  getSessionToken?: () => Promise<string | null>;
}

async function defaultGetSessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function triggerContextDerivation(
  projectId: string,
  dependencies: ContextDerivationTriggerDependencies = {},
): Promise<ContextDerivationTriggerResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const getSessionToken = dependencies.getSessionToken ?? defaultGetSessionToken;

  if (!WORKER_URL) {
    return { ok: false, code: "CONFIGURATION_MISSING", message: "The agent worker URL is not configured." };
  }

  const token = await getSessionToken();
  if (!token) {
    return { ok: false, code: "UNAUTHENTICATED", message: "Sign in to derive context from evidence." };
  }

  let response: Response;
  try {
    response = await fetcher(`${WORKER_URL}/projects/context-derivation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId }),
    });
  } catch {
    return { ok: false, code: "REQUEST_FAILED", message: "Could not reach the context derivation service." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "REQUEST_FAILED", message: "The context derivation service returned an unreadable response." };
  }

  if (!response.ok) {
    const errorBody = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const rawCode = typeof errorBody?.code === "string" ? errorBody.code : "";
    const message = typeof errorBody?.message === "string" ? errorBody.message : "Context derivation failed.";
    return { ok: false, code: WORKER_ERROR_CODE_MAP[rawCode] ?? "REQUEST_FAILED", message };
  }

  const result = body as {
    runId?: unknown;
    evidenceCount?: unknown;
    candidateCount?: unknown;
    acceptedCount?: unknown;
    droppedCount?: unknown;
  };
  if (typeof result.runId !== "string") {
    return { ok: false, code: "REQUEST_FAILED", message: "The context derivation service returned an incomplete result." };
  }

  return {
    ok: true,
    runId: result.runId,
    evidenceCount: typeof result.evidenceCount === "number" ? result.evidenceCount : 0,
    candidateCount: typeof result.candidateCount === "number" ? result.candidateCount : 0,
    acceptedCount: typeof result.acceptedCount === "number" ? result.acceptedCount : 0,
    droppedCount: typeof result.droppedCount === "number" ? result.droppedCount : 0,
  };
}
