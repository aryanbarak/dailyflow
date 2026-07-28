import { describe, expect, it, vi } from "vitest";
import { githubFilesUpdateHandler } from "./githubFilesUpdateHandler";
import type { ExecutionContext } from "../executionTypes";

function contextWith(updateFile: ReturnType<typeof vi.fn>): ExecutionContext {
  return { githubFileUpdateClient: { updateFile } };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: "code-proposal:abc",
    repo: "aryan/smartflow",
    path: "README.md",
    proposedContent: "hello world\n",
    ...overrides,
  };
}

describe("githubFilesUpdateHandler", () => {
  it("describes a high-risk write handler without weakening the write contract", () => {
    expect(githubFilesUpdateHandler).toMatchObject({
      toolId: "github.files.update",
      mode: "write",
      readOnly: false,
      externalEffect: true,
      reversible: false,
      requiresVerification: true,
    });
  });

  it("requires proposalId, repo, path, and proposedContent", () => {
    const result = githubFilesUpdateHandler.validateInput({}, []);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("proposalId is required.");
  });

  it("rejects arbitrary fields", () => {
    const result = githubFilesUpdateHandler.validateInput(validInput({ extra: 1 }), []);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("extra is not allowed for github.files.update.");
  });

  it("never accepts baseBlobSha, baseCommitSha, riskLevel, or expiresAt as input fields", () => {
    const result = githubFilesUpdateHandler.validateInput(
      validInput({ baseBlobSha: "x", baseCommitSha: "y", riskLevel: "high", expiresAt: "z" }),
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("baseBlobSha is not allowed for github.files.update.");
    expect(result.errors).toContain("baseCommitSha is not allowed for github.files.update.");
    expect(result.errors).toContain("riskLevel is not allowed for github.files.update.");
    expect(result.errors).toContain("expiresAt is not allowed for github.files.update.");
  });

  it("rejects a protected path and oversized or binary content, reusing the Slice 1 validators", () => {
    const protectedPath = githubFilesUpdateHandler.validateInput(validInput({ path: ".env" }), []);
    expect(protectedPath.valid).toBe(false);

    const oversized = githubFilesUpdateHandler.validateInput(validInput({ proposedContent: "x".repeat(128 * 1024 + 1) }), []);
    expect(oversized.valid).toBe(false);

    const binary = githubFilesUpdateHandler.validateInput(validInput({ proposedContent: "abc\u0000def" }), []);
    expect(binary.valid).toBe(false);
  });

  it("rejects invalid input without calling the client", async () => {
    const updateFile = vi.fn();
    const result = await githubFilesUpdateHandler.execute({}, contextWith(updateFile));

    expect(result.status).toBe("invalid_input");
    expect(updateFile).not.toHaveBeenCalled();
  });

  it("returns failed when GitHub is not connected", async () => {
    const result = await githubFilesUpdateHandler.execute(validInput(), {});
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("GITHUB_NOT_CONNECTED");
  });

  it("updates the file and returns verified success, omitting commitMessage when not provided", async () => {
    const updateFile = vi.fn().mockResolvedValue({
      repo: "aryan/smartflow",
      path: "README.md",
      branch: "smartflow/epic-08/abc123def456",
      commitSha: "commit-sha-1",
      blobSha: "blob-sha-1",
      commitUrl: "https://github.com/aryan/smartflow/commit/commit-sha-1",
    });
    const result = await githubFilesUpdateHandler.execute(validInput(), contextWith(updateFile));

    expect(updateFile).toHaveBeenCalledWith({
      proposalId: "code-proposal:abc",
      repo: "aryan/smartflow",
      path: "README.md",
      proposedContent: "hello world\n",
    });
    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      repo: "aryan/smartflow",
      path: "README.md",
      branch: "smartflow/epic-08/abc123def456",
      commitSha: "commit-sha-1",
      blobSha: "blob-sha-1",
      commitUrl: "https://github.com/aryan/smartflow/commit/commit-sha-1",
    });
    expect(result.auditMetadata).toEqual({ verified: true, resultShape: "object", redacted: true });
  });

  it("normalizes client errors without leaking raw payloads", async () => {
    const updateFile = vi.fn().mockRejectedValue({ code: "STALE_BASE", message: "The file has changed since it was approved." });
    const result = await githubFilesUpdateHandler.execute(validInput(), contextWith(updateFile));

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "STALE_BASE",
      message: "The file has changed since it was approved.",
      retryable: false,
    });
  });
});
