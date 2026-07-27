import { describe, expect, it, vi } from "vitest";
import { createGitHubIssuesUpdateClient } from "./githubIssuesUpdateClient";

describe("GitHub issue update write client", () => {
  it("sends a PATCH to the fixed update route, omitting fields the caller did not set", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      issueNumber: 5,
      url: "https://github.com/aryan/smartflow/issues/5",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createGitHubIssuesUpdateClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "supabase-session",
      fetcher: fetcher as typeof fetch,
    });

    const result = await client.updateIssue({ repo: "aryan/smartflow", issueNumber: 5, labels: ["bug"] });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8787/github/issues/update");
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer supabase-session");
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toEqual({ repo: "aryan/smartflow", issue_number: 5, labels: ["bug"] });
    expect(sentBody).not.toHaveProperty("title");
    expect(sentBody).not.toHaveProperty("body");
    expect(result).toEqual({ issueNumber: 5, url: "https://github.com/aryan/smartflow/issues/5" });
  });

  it("requires authentication before calling the worker", async () => {
    const fetcher = vi.fn();
    const client = createGitHubIssuesUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => undefined,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.updateIssue({ repo: "a/b", issueNumber: 1, title: "New" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the worker's specific error code instead of a generic failure", async () => {
    const client = createGitHubIssuesUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ error: { code: "LABELS_NOT_RECOGNIZED" } }), { status: 400 }),
    });
    await expect(client.updateIssue({ repo: "a/b", issueNumber: 1, labels: ["nope"] })).rejects.toMatchObject({ code: "LABELS_NOT_RECOGNIZED" });
  });

  it("fails closed for a malformed or untrusted response", async () => {
    const missingFields = createGitHubIssuesUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ issueNumber: 1 }), { status: 200 }),
    });
    await expect(missingFields.updateIssue({ repo: "a/b", issueNumber: 1, title: "x" })).rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });

    const untrustedHost = createGitHubIssuesUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ issueNumber: 1, url: "https://evil.example.com/x" }), { status: 200 }),
    });
    await expect(untrustedHost.updateIssue({ repo: "a/b", issueNumber: 1, title: "x" })).rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });
  });
});
