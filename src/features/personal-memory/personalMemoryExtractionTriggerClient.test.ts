import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

// CI-01c: same fix as contextDerivationTriggerClient.test.ts -- WORKER_URL
// is read once at module load time from
// import.meta.env.VITE_AGENT_WORKER_URL with no DI hook to override it, so
// the stub must be in place before the module first evaluates.
let triggerPersonalMemoryExtraction: typeof import("./personalMemoryExtractionTriggerClient").triggerPersonalMemoryExtraction;

beforeEach(async () => {
  vi.stubEnv("VITE_AGENT_WORKER_URL", "https://worker.example.test");
  vi.resetModules();
  ({ triggerPersonalMemoryExtraction } = await import("./personalMemoryExtractionTriggerClient"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

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

    expect(result).toEqual({ ok: true, runId: "run-1", sourceItemCount: 5, candidateCount: 3, acceptedCount: 2, droppedCount: 1, outcome: "completed" });
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

  it("task 13: returns NETWORK_UNREACHABLE (not the generic REQUEST_FAILED) when the fetch call itself throws -- a true network/unreachable failure, distinct from a worker HTTP error or an unreadable response", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "NETWORK_UNREACHABLE", message: "Could not reach the personal memory extraction service." });
  });

  it("task 13: an unreadable (non-JSON) but otherwise-reachable response is mapped separately from a network failure -- REQUEST_FAILED with its own message, never 'could not reach the service'", async () => {
    const unreadable = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response;
    const fetcher = vi.fn().mockResolvedValue(unreadable);

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({
      ok: false,
      code: "REQUEST_FAILED",
      message: "The personal memory extraction service returned an unreadable response.",
    });
  });

  it("task 14: maps the worker's PROVIDER_REQUEST_REJECTED to its own distinct code and message, not the generic REQUEST_FAILED", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(502, {
        error: {
          code: "PROVIDER_REQUEST_REJECTED",
          message: "The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your data.",
          providerStatus: 400,
          providerDetail: "The specified schema produces a constraint that has too many states for serving.",
        },
      }),
    );

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({
      ok: false,
      code: "PROVIDER_REQUEST_REJECTED",
      message: "The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your data.",
    });
  });

  it("task 14: maps the worker's PROVIDER_UNAVAILABLE to its own distinct code and message", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(502, { error: { code: "PROVIDER_UNAVAILABLE", message: "The AI model is temporarily unavailable. Please try again in a moment." } }),
    );

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE", message: "The AI model is temporarily unavailable. Please try again in a moment." });
  });

  it("task 14: maps the worker's MODEL_OUTPUT_UNUSABLE to its own distinct code and message", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(502, { error: { code: "MODEL_OUTPUT_UNUSABLE", message: "The model did not return a usable extraction. Please try again." } }),
    );

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "MODEL_OUTPUT_UNUSABLE", message: "The model did not return a usable extraction. Please try again." });
  });

  it("task 16-fix2: maps a partial-success response (EXTRACTION_PARTIAL) to outcome:'partial' with batch counts, still ok:true", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        runId: "run-1",
        sourceItemCount: 5,
        candidateCount: 4,
        acceptedCount: 4,
        droppedCount: 0,
        results: [],
        outcome: "partial",
        code: "EXTRACTION_PARTIAL",
        batchesTotal: 3,
        batchesSucceeded: 2,
        batchesFailed: 1,
      }),
    );

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({
      ok: true,
      runId: "run-1",
      sourceItemCount: 5,
      candidateCount: 4,
      acceptedCount: 4,
      droppedCount: 0,
      outcome: "partial",
      batchesTotal: 3,
      batchesSucceeded: 2,
      batchesFailed: 1,
    });
  });

  it("returns REQUEST_FAILED for a 200 response missing a runId, rather than reporting false success", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sourceItemCount: 1 }));

    const result = await triggerPersonalMemoryExtraction({ fetcher, getSessionToken: async () => "token-abc" });

    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("REQUEST_FAILED");
  });
});
