// SmartFlow -- Document-Sourced Memory, slice 1 (task 16). Browser-side
// client for the Worker's authenticated POST /documents/extract-memory
// route (agent/worker/document-memory-extraction-endpoint.ts). Forwards
// the signed-in user's own session token -- never a service-role key --
// mirroring contextDerivationTriggerClient.ts's / personalMemoryExtractionTriggerClient.ts's
// identical pattern.

import { supabase } from "@/integrations/supabase/client";

const WORKER_URL = (import.meta.env.VITE_AGENT_WORKER_URL as string | undefined) ?? "";

export type DocumentMemoryExtractionTriggerErrorCode =
  | "UNAUTHENTICATED"
  | "CONFIGURATION_MISSING"
  | "NETWORK_UNREACHABLE"
  | "NO_SOURCE_MATERIAL"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_TOO_LARGE"
  | "UNSUPPORTED_DOCUMENT_TYPE"
  | "PROVIDER_REQUEST_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_OUTPUT_UNUSABLE"
  | "REQUEST_FAILED";

export interface DocumentMemoryExtractionTriggerSuccess {
  readonly ok: true;
  readonly documentId: string;
  readonly chunkCount: number;
}

export interface DocumentMemoryExtractionTriggerFailure {
  readonly ok: false;
  readonly code: DocumentMemoryExtractionTriggerErrorCode;
  readonly message: string;
}

export type DocumentMemoryExtractionTriggerResult = DocumentMemoryExtractionTriggerSuccess | DocumentMemoryExtractionTriggerFailure;

const WORKER_ERROR_CODE_MAP: Record<string, DocumentMemoryExtractionTriggerErrorCode | undefined> = {
  UNAUTHORIZED: "UNAUTHENTICATED",
  CONFIGURATION_MISSING: "CONFIGURATION_MISSING",
  NO_SOURCE_MATERIAL: "NO_SOURCE_MATERIAL",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  DOCUMENT_TOO_LARGE: "DOCUMENT_TOO_LARGE",
  UNSUPPORTED_DOCUMENT_TYPE: "UNSUPPORTED_DOCUMENT_TYPE",
  PROVIDER_REQUEST_REJECTED: "PROVIDER_REQUEST_REJECTED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  MODEL_OUTPUT_UNUSABLE: "MODEL_OUTPUT_UNUSABLE",
};

export interface DocumentMemoryExtractionTriggerDependencies {
  fetcher?: typeof fetch;
  getSessionToken?: () => Promise<string | null>;
}

async function defaultGetSessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function triggerDocumentMemoryChunking(
  documentId: string,
  dependencies: DocumentMemoryExtractionTriggerDependencies = {},
): Promise<DocumentMemoryExtractionTriggerResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const getSessionToken = dependencies.getSessionToken ?? defaultGetSessionToken;

  if (!WORKER_URL) {
    return { ok: false, code: "CONFIGURATION_MISSING", message: "The agent worker URL is not configured." };
  }

  const token = await getSessionToken();
  if (!token) {
    return { ok: false, code: "UNAUTHENTICATED", message: "Sign in to extract this document to personal memory." };
  }

  // This try block wraps ONLY the fetch call -- mirrors
  // contextDerivationTriggerClient.ts's / personalMemoryExtractionTriggerClient.ts's
  // identical task 13 fix: a throw caught here is a true network/unreachable
  // failure, never a post-response parse/shape failure.
  let response: Response;
  try {
    response = await fetcher(`${WORKER_URL}/documents/extract-memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ documentId }),
    });
  } catch {
    return { ok: false, code: "NETWORK_UNREACHABLE", message: "Could not reach the document extraction service." };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "REQUEST_FAILED", message: "The document extraction service returned an unreadable response." };
  }

  if (!response.ok) {
    const errorBody = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const rawCode = typeof errorBody?.code === "string" ? errorBody.code : "";
    const message = typeof errorBody?.message === "string" ? errorBody.message : "Document extraction failed.";
    return { ok: false, code: WORKER_ERROR_CODE_MAP[rawCode] ?? "REQUEST_FAILED", message };
  }

  const result = body as { documentId?: unknown; chunkCount?: unknown };
  if (typeof result.documentId !== "string" || typeof result.chunkCount !== "number") {
    return { ok: false, code: "REQUEST_FAILED", message: "The document extraction service returned an incomplete result." };
  }

  return { ok: true, documentId: result.documentId, chunkCount: result.chunkCount };
}
