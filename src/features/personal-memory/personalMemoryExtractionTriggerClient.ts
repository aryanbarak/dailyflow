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
  | "NETWORK_UNREACHABLE"
  // Task 14 fix: the worker's three-way model-call taxonomy (replacing the
  // old generic MODEL_CALL_FAILED, which used to collapse into REQUEST_FAILED
  // here) -- see personal-memory-extraction-endpoint.ts's own
  // ProviderFailureTaxonomy for the full rationale.
  | "PROVIDER_REQUEST_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_OUTPUT_UNUSABLE"
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
  // Task 14 fix: pass these three through as their OWN distinct codes
  // rather than falling into the generic REQUEST_FAILED bucket (the
  // `?? "REQUEST_FAILED"` fallback below), so the UI can show a distinct,
  // honest message for each.
  PROVIDER_REQUEST_REJECTED: "PROVIDER_REQUEST_REJECTED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  MODEL_OUTPUT_UNUSABLE: "MODEL_OUTPUT_UNUSABLE",
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
  /** Task 16: when provided, the run sources from this document's chunks (agent/worker/document-memory-extraction-endpoint.ts must have chunked it first) instead of chat+briefing. Mirrors contextDerivationTriggerClient.ts's own projectId parameter shape. */
  documentId?: string,
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

  // Task 13 fix (honest error mapping): this try block wraps ONLY the fetch
  // call to the worker -- nothing else -- so any throw caught here really is
  // a true network/unreachable failure (DNS, CORS, offline, connection
  // refused), never a database or other unrelated error. Given its own,
  // more specific code (NETWORK_UNREACHABLE) rather than the generic
  // REQUEST_FAILED bucket used for post-response failures below (unreadable
  // JSON, missing runId, unmapped worker error codes) -- so a future
  // regression that widens this try block (e.g. adding a pre-check inside
  // it) cannot silently start mislabeling a non-network failure as
  // "could not reach the service" without this code's own meaning drifting
  // in an obviously wrong way.
  let response: Response;
  try {
    response = await fetcher(`${WORKER_URL}/personal-memory/extraction`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(documentId ? { documentId } : {}),
    });
  } catch {
    return { ok: false, code: "NETWORK_UNREACHABLE", message: "Could not reach the personal memory extraction service." };
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
