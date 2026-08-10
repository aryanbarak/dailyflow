import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { triggerDocumentMemoryChunking } from "./documentMemoryExtractionTriggerClient";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("triggerDocumentMemoryChunking", () => {
  it("returns UNAUTHENTICATED without ever calling fetch when there is no session token", async () => {
    const fetcher = vi.fn();
    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => null });

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED", message: "Sign in to extract this document to personal memory." });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the bearer token and documentId, and maps a successful response", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { documentId: DOCUMENT_ID, chunkCount: 4, extractionMethod: "model_transcription" }));

    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: true, documentId: DOCUMENT_ID, chunkCount: 4 });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("/documents/extract-memory");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(JSON.parse(init.body)).toEqual({ documentId: DOCUMENT_ID });
  });

  it("maps DOCUMENT_NOT_FOUND (404) to a typed, honest failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(404, { error: { code: "DOCUMENT_NOT_FOUND", message: "Document was not found for this user." } }));

    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "DOCUMENT_NOT_FOUND", message: "Document was not found for this user." });
  });

  it("maps NO_SOURCE_MATERIAL (422) to a typed, calm failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(422, { error: { code: "NO_SOURCE_MATERIAL", message: "No readable text was found in this document." } }));

    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "NO_SOURCE_MATERIAL", message: "No readable text was found in this document." });
  });

  it("maps the worker's PROVIDER_UNAVAILABLE to its own distinct code and message", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(502, { error: { code: "PROVIDER_UNAVAILABLE", message: "The AI model is temporarily unavailable. Please try again in a moment." } }),
    );

    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE", message: "The AI model is temporarily unavailable. Please try again in a moment." });
  });

  it("maps an unrecognized worker error code to REQUEST_FAILED while preserving the server's own message", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(500, { error: { code: "INTERNAL", message: "Something went wrong." } }));

    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "REQUEST_FAILED", message: "Something went wrong." });
  });

  it("returns NETWORK_UNREACHABLE (not the generic REQUEST_FAILED) when the fetch call itself throws", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "NETWORK_UNREACHABLE", message: "Could not reach the document extraction service." });
  });

  it("an unreadable (non-JSON) but otherwise-reachable response is REQUEST_FAILED, never 'could not reach the service'", async () => {
    const unreadable = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response;
    const fetcher = vi.fn().mockResolvedValue(unreadable);

    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "REQUEST_FAILED", message: "The document extraction service returned an unreadable response." });
  });

  it("returns REQUEST_FAILED for a 200 response missing chunkCount, rather than reporting false success", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { documentId: DOCUMENT_ID }));

    const result = await triggerDocumentMemoryChunking(DOCUMENT_ID, { fetcher, getSessionToken: async () => "token-abc" });

    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("REQUEST_FAILED");
  });
});
