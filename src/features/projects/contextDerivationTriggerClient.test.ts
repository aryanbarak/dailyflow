import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { triggerContextDerivation } from "./contextDerivationTriggerClient";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("triggerContextDerivation", () => {
  it("returns UNAUTHENTICATED without ever calling fetch when there is no session token", async () => {
    const fetcher = vi.fn();
    const result = await triggerContextDerivation("project-1", {
      fetcher,
      getSessionToken: async () => null,
    });

    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED", message: "Sign in to derive context from evidence." });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the bearer token and project id, and maps a successful response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        runId: "run-1",
        startedAt: "2026-08-08T00:00:00.000Z",
        completedAt: "2026-08-08T00:00:05.000Z",
        evidenceCount: 4,
        candidateCount: 6,
        acceptedCount: 5,
        droppedCount: 1,
        results: [],
      }),
    );

    const result = await triggerContextDerivation("project-1", {
      fetcher,
      getSessionToken: async () => "token-abc",
    });

    expect(result).toEqual({ ok: true, runId: "run-1", evidenceCount: 4, candidateCount: 6, acceptedCount: 5, droppedCount: 1 });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain("/projects/context-derivation");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(JSON.parse(init.body)).toEqual({ projectId: "project-1" });
  });

  it("maps the worker's NO_ELIGIBLE_EVIDENCE (422) error to a typed, honest failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(422, { error: { code: "NO_ELIGIBLE_EVIDENCE", message: "This project has no active evidence to derive context from yet." } }),
    );

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({
      ok: false,
      code: "NO_ELIGIBLE_EVIDENCE",
      message: "This project has no active evidence to derive context from yet.",
    });
  });

  it("maps PROJECT_ARCHIVED (409) to a typed failure", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: "PROJECT_ARCHIVED", message: "Cannot derive context for an archived project." } }));

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "PROJECT_ARCHIVED", message: "Cannot derive context for an archived project." });
  });

  it("maps an unrecognized worker error code to REQUEST_FAILED while preserving the server's own message", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(502, { error: { code: "MODEL_CALL_FAILED", message: "The model did not return a usable derivation." } }));

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "REQUEST_FAILED", message: "The model did not return a usable derivation." });
  });

  it("task R-3: returns NETWORK_UNREACHABLE (not the generic REQUEST_FAILED) when the fetch call itself throws -- a true network/unreachable failure, distinct from a worker HTTP error or an unreadable response", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "NETWORK_UNREACHABLE", message: "Could not reach the context derivation service." });
  });

  it("task R-3: an unreadable (non-JSON) but otherwise-reachable response is mapped separately from a network failure -- REQUEST_FAILED with its own message, never 'could not reach the service'", async () => {
    const unreadable = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    } as unknown as Response;
    const fetcher = vi.fn().mockResolvedValue(unreadable);

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({
      ok: false,
      code: "REQUEST_FAILED",
      message: "The context derivation service returned an unreadable response.",
    });
  });

  it("task R-3: maps the worker's PROVIDER_REQUEST_REJECTED to its own distinct code and message, not the generic REQUEST_FAILED", async () => {
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

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({
      ok: false,
      code: "PROVIDER_REQUEST_REJECTED",
      message: "The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your data.",
    });
  });

  it("task R-3: maps the worker's PROVIDER_UNAVAILABLE to its own distinct code and message", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(502, { error: { code: "PROVIDER_UNAVAILABLE", message: "The AI model is temporarily unavailable. Please try again in a moment." } }),
    );

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE", message: "The AI model is temporarily unavailable. Please try again in a moment." });
  });

  it("task R-3: maps the worker's MODEL_OUTPUT_UNUSABLE to its own distinct code and message", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(502, { error: { code: "MODEL_OUTPUT_UNUSABLE", message: "The model did not return a usable derivation. Please try again." } }),
    );

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result).toEqual({ ok: false, code: "MODEL_OUTPUT_UNUSABLE", message: "The model did not return a usable derivation. Please try again." });
  });

  it("returns REQUEST_FAILED for a 200 response missing a runId, rather than reporting false success", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { evidenceCount: 1 }));

    const result = await triggerContextDerivation("project-1", { fetcher, getSessionToken: async () => "token-abc" });

    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("REQUEST_FAILED");
  });
});
