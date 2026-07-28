import { describe, expect, it, vi } from "vitest";
import { createGitHubFileUpdateClient } from "./githubFileUpdateClient";

describe("GitHub file update write client (EPIC-08 Slice 3)", () => {
  it("sends a POST to the fixed update route with exactly proposalId/repo/path/proposedContent, omitting commitMessage when unset", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      repo: "aryan/smartflow",
      path: "README.md",
      branch: "smartflow/epic-08/abc123def456",
      commitSha: "commit-sha-1",
      blobSha: "blob-sha-1",
      commitUrl: "https://github.com/aryan/smartflow/commit/commit-sha-1",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createGitHubFileUpdateClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "supabase-session",
      fetcher: fetcher as typeof fetch,
    });

    const result = await client.updateFile({
      proposalId: "code-proposal:abc",
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8787/github/files/update");
    const init = fetcher.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer supabase-session");
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toEqual({
      proposalId: "code-proposal:abc",
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
    });
    expect(sentBody).not.toHaveProperty("commitMessage");
    expect(sentBody).not.toHaveProperty("baseBlobSha");
    expect(sentBody).not.toHaveProperty("baseCommitSha");
    expect(sentBody).not.toHaveProperty("riskLevel");
    expect(result).toEqual({
      repo: "aryan/smartflow",
      path: "README.md",
      branch: "smartflow/epic-08/abc123def456",
      commitSha: "commit-sha-1",
      blobSha: "blob-sha-1",
      commitUrl: "https://github.com/aryan/smartflow/commit/commit-sha-1",
    });
  });

  it("includes commitMessage when the caller sets it", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      repo: "a/b", path: "x.md", branch: "smartflow/epic-08/abc123def456",
      commitSha: "c", blobSha: "b", commitUrl: "https://github.com/a/b/commit/c",
    }), { status: 200 }));
    const client = createGitHubFileUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: fetcher as typeof fetch,
    });

    await client.updateFile({ proposalId: "p", repo: "a/b", path: "x.md", proposedContent: "y", commitMessage: "Fix x" });

    const sentBody = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.commitMessage).toBe("Fix x");
  });

  it("requires authentication before calling the worker", async () => {
    const fetcher = vi.fn();
    const client = createGitHubFileUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => undefined,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.updateFile({ proposalId: "p", repo: "a/b", path: "x.md", proposedContent: "y" }))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the worker's specific error code instead of a generic failure", async () => {
    const client = createGitHubFileUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ error: { code: "STALE_BASE" } }), { status: 409 }),
    });
    await expect(client.updateFile({ proposalId: "p", repo: "a/b", path: "x.md", proposedContent: "y" }))
      .rejects.toMatchObject({ code: "STALE_BASE" });
  });

  it("fails closed for a malformed or untrusted response", async () => {
    const missingFields = createGitHubFileUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ repo: "a/b" }), { status: 200 }),
    });
    await expect(missingFields.updateFile({ proposalId: "p", repo: "a/b", path: "x.md", proposedContent: "y" }))
      .rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });

    const untrustedHost = createGitHubFileUpdateClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({
        repo: "a/b", path: "x.md", branch: "smartflow/epic-08/abc123def456",
        commitSha: "c", blobSha: "b", commitUrl: "https://evil.example.com/x",
      }), { status: 200 }),
    });
    await expect(untrustedHost.updateFile({ proposalId: "p", repo: "a/b", path: "x.md", proposedContent: "y" }))
      .rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });
  });
});
