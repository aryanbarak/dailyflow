import { describe, expect, it, vi } from "vitest";
import { createGitHubRepositoryInventoryClient } from "./githubRepositoryInventoryClient";

describe("GitHub repository inventory browser client", () => {
  it("calls only the fixed inventory route with runtime authentication and returns known names", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "known",
      names: ["aryan/smart-academy", "aryan/dailyflow"],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createGitHubRepositoryInventoryClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "supabase-session",
      fetcher: fetcher as typeof fetch,
    });
    const result = await client.getInventory();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8787/github/repository-inventory");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer supabase-session");
    expect(result).toEqual({ status: "known", names: ["aryan/smart-academy", "aryan/dailyflow"] });
  });

  it("returns known with an empty list distinctly from unknown", async () => {
    const client = createGitHubRepositoryInventoryClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ status: "known", names: [] }), { status: 200 }),
    });
    expect(await client.getInventory()).toEqual({ status: "known", names: [] });
  });

  it("degrades to unknown, never throws, on every failure mode", async () => {
    const noAuth = createGitHubRepositoryInventoryClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => undefined,
    });
    expect(await noAuth.getInventory()).toEqual({ status: "unknown" });

    const networkError = createGitHubRepositoryInventoryClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => { throw new Error("network down"); },
    });
    expect(await networkError.getInventory()).toEqual({ status: "unknown" });

    const nonOk = createGitHubRepositoryInventoryClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response("{}", { status: 500 }),
    });
    expect(await nonOk.getInventory()).toEqual({ status: "unknown" });

    const malformed = createGitHubRepositoryInventoryClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response("not-json", { status: 200 }),
    });
    expect(await malformed.getInventory()).toEqual({ status: "unknown" });

    const wrongShape = createGitHubRepositoryInventoryClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ status: "known", names: "not-an-array" }), { status: 200 }),
    });
    expect(await wrongShape.getInventory()).toEqual({ status: "unknown" });
  });

  it("bounds and sanitizes names defensively even though the Worker already bounds them", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `owner/repo-${i}`);
    const client = createGitHubRepositoryInventoryClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ status: "known", names: [...names, 123, null] }), { status: 200 }),
    });
    const result = await client.getInventory();
    expect(result.status).toBe("known");
    expect(result.status === "known" && result.names).toHaveLength(12);
  });
});
