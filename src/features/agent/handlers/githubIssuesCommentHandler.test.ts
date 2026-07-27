import { describe, expect, it, vi } from "vitest";
import { githubIssuesCommentHandler } from "./githubIssuesCommentHandler";
import type { ExecutionContext } from "../executionTypes";

function contextWith(createComment: ReturnType<typeof vi.fn>): ExecutionContext {
  return { githubIssueCommentClient: { createComment } };
}

describe("githubIssuesCommentHandler", () => {
  it("describes a write handler without weakening the read-only handler contract", () => {
    expect(githubIssuesCommentHandler).toMatchObject({
      toolId: "github.issues.comment",
      mode: "write",
      readOnly: false,
      externalEffect: true,
      reversible: false,
      requiresVerification: true,
      timeoutMs: 10_000,
    });
  });

  it("validates exact input and rejects arbitrary fields", () => {
    const valid = githubIssuesCommentHandler.validateInput({ repo: "a/b", issueNumber: 1, body: "hi" }, []);
    const invalid = githubIssuesCommentHandler.validateInput({
      repo: "a/b",
      issueNumber: 1,
      body: "hi",
      token: "must-not-pass",
    }, []);
    const badRepo = githubIssuesCommentHandler.validateInput({ repo: "not-a-repo", issueNumber: 1, body: "hi" }, []);

    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain("token is not allowed for github.issues.comment.");
    expect(badRepo.valid).toBe(false);
  });

  it("rejects invalid input without calling the client", async () => {
    const createComment = vi.fn();
    const result = await githubIssuesCommentHandler.execute({ repo: "a/b" }, contextWith(createComment));

    expect(result.status).toBe("invalid_input");
    expect(createComment).not.toHaveBeenCalled();
  });

  it("returns failed when GitHub is not connected", async () => {
    const result = await githubIssuesCommentHandler.execute({ repo: "a/b", issueNumber: 1, body: "hi" }, {});
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("GITHUB_NOT_CONNECTED");
  });

  it("posts the comment and returns verified success", async () => {
    const createComment = vi.fn().mockResolvedValue({ commentId: 42, url: "https://github.com/a/b/issues/1#issuecomment-42" });
    const result = await githubIssuesCommentHandler.execute(
      { repo: "a/b", issueNumber: 1, body: "Thanks!" },
      contextWith(createComment),
    );

    expect(createComment).toHaveBeenCalledWith({ repo: "a/b", issueNumber: 1, body: "Thanks!" });
    expect(result.status).toBe("success");
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ commentId: 42, url: "https://github.com/a/b/issues/1#issuecomment-42" });
    expect(result.auditMetadata).toEqual({ verified: true, resultShape: "object", redacted: true });
  });

  it("normalizes client errors without leaking raw payloads", async () => {
    const createComment = vi.fn().mockRejectedValue({ code: "WRITE_RATE_LIMIT_EXCEEDED", message: "Write rate limit exceeded. Try again later." });
    const result = await githubIssuesCommentHandler.execute(
      { repo: "a/b", issueNumber: 1, body: "hi" },
      contextWith(createComment),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "WRITE_RATE_LIMIT_EXCEEDED",
      message: "Write rate limit exceeded. Try again later.",
      retryable: false,
    });
  });
});
