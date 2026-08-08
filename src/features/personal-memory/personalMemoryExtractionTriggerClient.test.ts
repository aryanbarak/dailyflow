import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { triggerPersonalMemoryExtraction } from "./personalMemoryExtractionTriggerClient";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("triggerPersonalMemoryExtraction", () => {
  it("returns UNAUTHENTICATED without ever calling fetch when there is no session token", async () => {
    const fetcher = vi.fn();
    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => null });

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED", message: "Sign in to check for new personal memory." });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the bearer token and an empty JSON body, and maps a successful response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        runId: "run-1",
        startedAt: "2026-08-08T00:00:00.000Z",
        completedAt: "2026-08-08T00:00:05.000Z",
        sourceItemCount: 5,
        candidateCount: 3,
        acceptedCount: 2,
        droppedCount: 1,
        results: [],
      }),
    );

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: true, runId: "run-1", sourceItemCount: 5, candidateCount: 3, acceptedCount: 2, droppedCount: 1 });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("/personal-memory/extraction");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("maps the worker's NO_SOURCE_MATERIAL (422) error to a typed, honest failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(422, { error: { code: "NO_SOURCE_MATERIAL", message: "No chat messages or briefings exist yet to extract personal memory from." } }),
    );

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({
      ok: false,
      code: "NO_SOURCE_MATERIAL",
      message: "No chat messages or briefings exist yet to extract personal memory from.",
    });
  });

  it("maps CONFIGURATION_MISSING (503) to a typed failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(503, { error: { code: "CONFIGURATION_MISSING", message: "GEMINI_API_KEY is required." } }));

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "CONFIGURATION_MISSING", message: "GEMINI_API_KEY is required." });
  });

  it("maps an unrecognized worker error code to REQUEST_FAILED while preserving the server's own message", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(502, { error: { code: "MODEL_CALL_FAILED", message: "The model did not return a usable extraction." } }));

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "REQUEST_FAILED", message: "The model did not return a usable extraction." });
  });

  it("returns REQUEST_FAILED when the network call itself throws", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "REQUEST_FAILED", message: "Could not reach the personal memory extraction service." });
  });

  it("returns REQUEST_FAILED for a 200 response missing a runId, rather than reporting false success", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sourceItemCount: 1 }));

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("REQUEST_FAILED");
  });
});
