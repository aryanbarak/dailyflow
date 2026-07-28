import { describe, expect, it, vi } from "vitest";
import { createGitHubFileContentClient } from "./githubFileContentClient";

describe("GitHub file content browser client", () => {
  it("calls the files/read route with repo and path as query params and runtime authentication", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      repo: "aryan/smartflow",
      path: "README.md",
      branch: "main",
      blobSha: "blob-sha-1",
      commitSha: "commit-sha-1",
      content: "hello\n",
      size: 6,
      installationToken: "must-not-pass",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createGitHubFileContentClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "supabase-session",
      fetcher: fetcher as typeof fetch,
    });
    const result = await client.readFile({ repo: "aryan/smartflow", path: "README.md" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetcher.mock.calls[0];
    const url = new URL(String(calledUrl));
    expect(url.pathname).toBe("/github/files/read");
    expect(url.searchParams.get("repo")).toBe("aryan/smartflow");
    expect(url.searchParams.get("path")).toBe("README.md");
    expect(new Headers(calledInit?.headers).get("Authorization")).toBe("Bearer supabase-session");
    expect(result).toEqual({
      connectionStatus: "connected",
      file: {
        repo: "aryan/smartflow",
        path: "README.md",
        branch: "main",
        blobSha: "blob-sha-1",
        commitSha: "commit-sha-1",
        content: "hello\n",
        size: 6,
      },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-pass");
  });

  it("maps a 409 not-connected response distinctly from a malformed response", async () => {
    const notConnected = createGitHubFileContentClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response("{}", { status: 409 }),
    });
    expect(await notConnected.readFile({ repo: "aryan/smartflow", path: "README.md" })).toEqual({
      connectionStatus: "not_connected",
      file: null,
    });

    const malformed = createGitHubFileContentClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ repo: "aryan/smartflow" }), { status: 200 }),
    });
    await expect(malformed.readFile({ repo: "aryan/smartflow", path: "README.md" }))
      .rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });
  });

  it("requires authentication before constructing a request", async () => {
    const client = createGitHubFileContentClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => undefined,
      fetcher: async () => {
        throw new Error("must not be called");
      },
    });
    await expect(client.readFile({ repo: "aryan/smartflow", path: "README.md" }))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("fails closed on a non-2xx, non-409 response without leaking provider detail", async () => {
    const client = createGitHubFileContentClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ error: { code: "FILE_NOT_UTF8", internal: "stack trace" } }), { status: 400 }),
    });
    await expect(client.readFile({ repo: "aryan/smartflow", path: "image.png" }))
      .rejects.toMatchObject({ code: "GITHUB_FILE_READ_FAILED" });
  });
});
