import { describe, expect, it, vi } from "vitest";
import { createSanitizedFetch } from "./sanitizedSupabaseFetch";

describe("createSanitizedFetch (CI-01b: real product defect fix)", () => {
  it("passes through a successful response unchanged", async () => {
    const baseFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const sanitized = createSanitizedFetch(baseFetch as unknown as typeof fetch);

    const response = await sanitized("https://example.supabase.co/auth/v1/user");

    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("passes through a non-2xx response unchanged (e.g. a real 401) -- never intercepted, only a REJECTION is", async () => {
    const baseFetch = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }));
    const sanitized = createSanitizedFetch(baseFetch as unknown as typeof fetch);

    const response = await sanitized("https://example.supabase.co/auth/v1/user");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_token" });
  });

  // The actual regression proof: a rejecting base fetch (what a real
  // ECONNREFUSED/DNS-failure/timeout looks like) must resolve, not reject,
  // so @supabase/auth-js's own _handleRequest never sees a caught
  // exception and never reaches its `console.error(e)` line.
  it("converts a rejecting fetch (network failure) into a resolved 5xx Response instead of throwing", async () => {
    const networkError = new TypeError("fetch failed");
    (networkError as Error & { cause?: unknown }).cause = { code: "ECONNREFUSED", address: "127.0.0.1", port: 54321 };
    const baseFetch = vi.fn(async () => { throw networkError; });
    const sanitized = createSanitizedFetch(baseFetch as unknown as typeof fetch);

    const response = await sanitized("https://example.supabase.co/auth/v1/user");

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.status).toBeLessThan(600);
  });

  it("the synthetic failure Response's status is one @supabase/auth-js's own NETWORK_ERROR_CODES list already treats as retryable (502/503/504) -- so it takes the SDK's existing sanitized path, not a new one", async () => {
    const baseFetch = vi.fn(async () => { throw new Error("network down"); });
    const sanitized = createSanitizedFetch(baseFetch as unknown as typeof fetch);

    const response = await sanitized("https://example.supabase.co/auth/v1/user");

    expect([502, 503, 504]).toContain(response.status);
  });

  it("never includes the underlying error's own message/cause in the synthetic response body -- fixed, bounded text only", async () => {
    const sensitiveError = new Error("connect ECONNREFUSED 127.0.0.1:54321 at /some/internal/path.ts:42");
    const baseFetch = vi.fn(async () => { throw sensitiveError; });
    const sanitized = createSanitizedFetch(baseFetch as unknown as typeof fetch);

    const response = await sanitized("https://example.supabase.co/auth/v1/user");
    const bodyText = await response.text();

    expect(bodyText).not.toContain("ECONNREFUSED");
    expect(bodyText).not.toContain("127.0.0.1");
    expect(bodyText).not.toContain(".ts:");
  });

  it("defaults to globalThis.fetch when no base fetch is supplied", () => {
    const sanitized = createSanitizedFetch();
    expect(typeof sanitized).toBe("function");
  });

  it("passes input and init through to the base fetch unchanged", async () => {
    const baseFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const sanitized = createSanitizedFetch(baseFetch as unknown as typeof fetch);
    const init = { method: "GET", headers: { Authorization: "Bearer x" } };

    await sanitized("https://example.supabase.co/auth/v1/user", init);

    expect(baseFetch).toHaveBeenCalledWith("https://example.supabase.co/auth/v1/user", init);
  });
});
