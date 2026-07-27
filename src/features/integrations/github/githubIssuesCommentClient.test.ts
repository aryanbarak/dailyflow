import { describe, expect, it, vi } from "vitest";
import { createGitHubIssuesCommentClient } from "./githubIssuesCommentClient";

describe("GitHub issue comment write client", () => {
  it("posts to the fixed comment route with runtime authentication and the exact input shape", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      commentId: 42,
      url: "https://github.com/aryan/smartflow/issues/1#issuecomment-42",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createGitHubIssuesCommentClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "supabase-session",
      fetcher: fetcher as typeof fetch,
    });

    const result = await client.createComment({ repo: "aryan/smartflow", issueNumber: 1, body: "Thanks!" });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8787/github/issues/comment");
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer supabase-session");
    expect(JSON.parse(init?.body as string)).toEqual({ repo: "aryan/smartflow", issue_number: 1, body: "Thanks!" });
    expect(result).toEqual({ commentId: 42, url: "https://github.com/aryan/smartflow/issues/1#issuecomment-42" });
  });

  it("requires authentication before calling the worker", async () => {
    const fetcher = vi.fn();
    const client = createGitHubIssuesCommentClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => undefined,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.createComment({ repo: "a/b", issueNumber: 1, body: "hi" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the worker's specific error code instead of a generic failure", async () => {
    const client = createGitHubIssuesCommentClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ error: { code: "WRITE_RATE_LIMIT_EXCEEDED" } }), { status: 429 }),
    });
    await expect(client.createComment({ repo: "a/b", issueNumber: 1, body: "hi" })).rejects.toMatchObject({ code: "WRITE_RATE_LIMIT_EXCEEDED" });
  });

  it("fails closed for a malformed or untrusted response", async () => {
    const missingFields = createGitHubIssuesCommentClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ commentId: 1 }), { status: 200 }),
    });
    await expect(missingFields.createComment({ repo: "a/b", issueNumber: 1, body: "hi" })).rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });

    const untrustedHost = createGitHubIssuesCommentClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ commentId: 1, url: "https://evil.example.com/x" }), { status: 200 }),
    });
    await expect(untrustedHost.createComment({ repo: "a/b", issueNumber: 1, body: "hi" })).rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });
  });
});
