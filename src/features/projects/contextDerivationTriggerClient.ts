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
  | "NETWORK_UNREACHABLE"
  // Task R-3 fix (parity with personalMemoryExtractionTriggerClient.ts's
  // identical task 14 fix): the worker's three-way model-call taxonomy
  // (see context-derivation-endpoint.ts's own ProviderFailureTaxonomy),
  // passed through as its own distinct code rather than collapsing into
  // the generic REQUEST_FAILED bucket.
  | "PROVIDER_REQUEST_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_OUTPUT_UNUSABLE"
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
  // Task R-3 fix: pass these three through as their OWN distinct codes
  // rather than falling into the generic REQUEST_FAILED bucket (the
  // `?? "REQUEST_FAILED"` fallback below), so the UI can show a distinct,
  // honest message for each -- mirrors personalMemoryExtractionTriggerClient.ts's
  // identical task 14 fix.
  PROVIDER_REQUEST_REJECTED: "PROVIDER_REQUEST_REJECTED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  MODEL_OUTPUT_UNUSABLE: "MODEL_OUTPUT_UNUSABLE",
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

  // Task R-3 fix (parity with personalMemoryExtractionTriggerClient.ts's
  // identical task 13 fix): this try block wraps ONLY the fetch call to
  // the worker -- nothing else -- so any throw caught here really is a
  // true network/unreachable failure (DNS, CORS, offline, connection
  // refused), never a database or other unrelated error. Given its own,
  // more specific code (NETWORK_UNREACHABLE) rather than the generic
  // REQUEST_FAILED bucket used for post-response failures below (unreadable
  // JSON, missing runId, unmapped worker error codes).
  let response: Response;
  try {
    response = await fetcher(`${WORKER_URL}/projects/context-derivation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId }),
    });
  } catch {
    return { ok: false, code: "NETWORK_UNREACHABLE", message: "Could not reach the context derivation service." };
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
