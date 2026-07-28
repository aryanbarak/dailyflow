import { describe, expect, it, vi } from "vitest";
import { createCodeProposalApprovalClient } from "./codeProposalApprovalClient";

describe("code proposal approval recording client (EPIC-08 Slice 3)", () => {
  it("sends a POST to the fixed approve route with exactly proposalId/repo/path/proposedContent", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      proposalId: "code-proposal:abc",
      expiresAt: "2026-07-28T10:15:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = createCodeProposalApprovalClient({
      workerBaseUrl: "http://127.0.0.1:8787",
      getAccessToken: async () => "supabase-session",
      fetcher: fetcher as typeof fetch,
    });

    const result = await client.recordApproval({
      proposalId: "code-proposal:abc",
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8787/github/code-proposals/approve");
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
    expect(sentBody).not.toHaveProperty("baseBlobSha");
    expect(sentBody).not.toHaveProperty("baseCommitSha");
    expect(sentBody).not.toHaveProperty("proposedContentDigest");
    expect(sentBody).not.toHaveProperty("riskLevel");
    expect(sentBody).not.toHaveProperty("expiresAt");
    expect(result).toEqual({ proposalId: "code-proposal:abc", expiresAt: "2026-07-28T10:15:00.000Z" });
  });

  it("requires authentication before calling the worker", async () => {
    const fetcher = vi.fn();
    const client = createCodeProposalApprovalClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => undefined,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.recordApproval({ proposalId: "p", repo: "a/b", path: "x.md", proposedContent: "y" }))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("surfaces the worker's specific error code instead of a generic failure", async () => {
    const client = createCodeProposalApprovalClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ error: { code: "PROPOSAL_ID_MISMATCH" } }), { status: 409 }),
    });
    await expect(client.recordApproval({ proposalId: "p", repo: "a/b", path: "x.md", proposedContent: "y" }))
      .rejects.toMatchObject({ code: "PROPOSAL_ID_MISMATCH" });
  });

  it("fails closed for a malformed response", async () => {
    const client = createCodeProposalApprovalClient({
      workerBaseUrl: "https://worker.example.com",
      getAccessToken: async () => "session",
      fetcher: async () => new Response(JSON.stringify({ proposalId: "p" }), { status: 200 }),
    });
    await expect(client.recordApproval({ proposalId: "p", repo: "a/b", path: "x.md", proposedContent: "y" }))
      .rejects.toMatchObject({ code: "GITHUB_RESPONSE_INVALID" });
  });
});
