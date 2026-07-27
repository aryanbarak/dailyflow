import { describe, expect, it, vi } from "vitest";
import { githubIssuesUpdateHandler } from "./githubIssuesUpdateHandler";
import type { ExecutionContext } from "../executionTypes";

function contextWith(updateIssue: ReturnType<typeof vi.fn>): ExecutionContext {
  return { githubIssueUpdateClient: { updateIssue } };
}

describe("githubIssuesUpdateHandler", () => {
  it("describes a write handler without weakening the read-only handler contract", () => {
    expect(githubIssuesUpdateHandler).toMatchObject({
      toolId: "github.issues.update",
      mode: "write",
      readOnly: false,
      externalEffect: true,
      reversible: false,
      requiresVerification: true,
      timeoutMs: 10_000,
    });
  });

  it("requires at least one of title/body/labels", () => {
    const result = githubIssuesUpdateHandler.validateInput({ repo: "a/b", issueNumber: 1 }, []);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("At least one of title, body, or labels is required.");
  });

  it("rejects arbitrary fields and malformed labels", () => {
    const invalidField = githubIssuesUpdateHandler.validateInput({ repo: "a/b", issueNumber: 1, title: "x", extra: 1 }, []);
    const invalidLabels = githubIssuesUpdateHandler.validateInput({ repo: "a/b", issueNumber: 1, labels: ["", "  "] }, []);

    expect(invalidField.valid).toBe(false);
    expect(invalidField.errors).toContain("extra is not allowed for github.issues.update.");
    expect(invalidLabels.valid).toBe(false);
  });

  it("rejects invalid input without calling the client", async () => {
    const updateIssue = vi.fn();
    const result = await githubIssuesUpdateHandler.execute({ repo: "a/b", issueNumber: 1 }, contextWith(updateIssue));

    expect(result.status).toBe("invalid_input");
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("returns failed when GitHub is not connected", async () => {
    const result = await githubIssuesUpdateHandler.execute({ repo: "a/b", issueNumber: 1, title: "x" }, {});
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("GITHUB_NOT_CONNECTED");
  });

  it("updates the issue and returns verified success, omitting fields not provided", async () => {
    const updateIssue = vi.fn().mockResolvedValue({ issueNumber: 1, url: "https://github.com/a/b/issues/1" });
    const result = await githubIssuesUpdateHandler.execute(
      { repo: "a/b", issueNumber: 1, labels: ["bug"] },
      contextWith(updateIssue),
    );

    expect(updateIssue).toHaveBeenCalledWith({ repo: "a/b", issueNumber: 1, labels: ["bug"] });
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ issueNumber: 1, url: "https://github.com/a/b/issues/1" });
    expect(result.auditMetadata).toEqual({ verified: true, resultShape: "object", redacted: true });
  });

  it("normalizes client errors without leaking raw payloads", async () => {
    const updateIssue = vi.fn().mockRejectedValue({ code: "LABELS_NOT_RECOGNIZED", message: "One or more labels do not exist on this repository." });
    const result = await githubIssuesUpdateHandler.execute(
      { repo: "a/b", issueNumber: 1, labels: ["nope"] },
      contextWith(updateIssue),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({
      code: "LABELS_NOT_RECOGNIZED",
      message: "One or more labels do not exist on this repository.",
      retryable: false,
    });
  });
});
