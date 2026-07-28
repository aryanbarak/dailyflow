import { describe, expect, it } from "vitest";
import {
  buildApprovalPreview,
  buildCodeFileProposal,
  checkStaleBase,
  computeContentDigest,
} from "./codeProposalBuilder";
import type { CodeFileReadResult } from "./codeProposalTypes";

function baseRead(overrides: Partial<CodeFileReadResult> = {}): CodeFileReadResult {
  return {
    repo: "aryan/smartflow",
    path: "README.md",
    branch: "main",
    blobSha: "blob-sha-1",
    commitSha: "commit-sha-1",
    content: "hello\n",
    size: 6,
    ...overrides,
  };
}

describe("computeContentDigest", () => {
  it("matches the known SHA-256 hex digest of the empty string", async () => {
    expect(await computeContentDigest("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic for the same content", async () => {
    const first = await computeContentDigest("hello world");
    const second = await computeContentDigest("hello world");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different content", async () => {
    const a = await computeContentDigest("a");
    const b = await computeContentDigest("b");
    expect(a).not.toBe(b);
  });
});

describe("buildCodeFileProposal", () => {
  it("builds a valid proposal with digests, diff, and operationCount=1", async () => {
    const result = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello world\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.proposal.operationCount).toBe(1);
    expect(result.proposal.repo).toBe("aryan/smartflow");
    expect(result.proposal.baseBlobSha).toBe("blob-sha-1");
    expect(result.proposal.baseCommitSha).toBe("commit-sha-1");
    expect(result.proposal.baseContentDigest).toBe(await computeContentDigest("hello\n"));
    expect(result.proposal.proposedContentDigest).toBe(await computeContentDigest("hello world\n"));
    expect(result.proposal.diff.isNoop).toBe(false);
  });

  it("fails closed for a protected base path even if content is otherwise valid", async () => {
    const result = await buildCodeFileProposal({
      baseRead: baseRead({ path: ".env" }),
      proposedContent: "SECRET=1\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    expect(result.ok).toBe(false);
    if (result.ok === true) return;
    expect(result.errors.some((error) => error.includes("protected"))).toBe(true);
  });

  it("fails closed for oversized proposed content", async () => {
    const result = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "x".repeat(200_000),
      requestId: "request:1",
      stepId: "step:1",
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed for binary proposed content", async () => {
    const result = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "abc\u0000def",
      requestId: "request:1",
      stepId: "step:1",
    });
    expect(result.ok).toBe(false);
  });

  it("requires a non-empty requestId and stepId", async () => {
    const result = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello world\n",
      requestId: "",
      stepId: "step:1",
    });
    expect(result.ok).toBe(false);
  });
});

describe("checkStaleBase", () => {
  it("reports not stale when nothing has changed", async () => {
    const build = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello world\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    if (build.ok === false) throw new Error("expected build to succeed");
    const result = await checkStaleBase(build.proposal, baseRead());
    expect(result).toEqual({ stale: false, reasons: [] });
  });

  it("detects a changed blob SHA", async () => {
    const build = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello world\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    if (build.ok === false) throw new Error("expected build to succeed");
    const result = await checkStaleBase(build.proposal, baseRead({ blobSha: "blob-sha-2" }));
    expect(result.stale).toBe(true);
    expect(result.reasons).toContain("blob_sha_changed");
  });

  it("detects a changed commit SHA independently of the blob SHA", async () => {
    const build = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello world\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    if (build.ok === false) throw new Error("expected build to succeed");
    const result = await checkStaleBase(build.proposal, baseRead({ commitSha: "commit-sha-2" }));
    expect(result.stale).toBe(true);
    expect(result.reasons).toEqual(["commit_sha_changed"]);
  });

  it("detects content drift even when SHAs are unchanged (a stale mock SHA cannot hide a content change)", async () => {
    const build = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello world\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    if (build.ok === false) throw new Error("expected build to succeed");
    const result = await checkStaleBase(build.proposal, baseRead({ content: "different content\n" }));
    expect(result.stale).toBe(true);
    expect(result.reasons).toContain("content_digest_changed");
  });

  it("can report multiple simultaneous reasons", async () => {
    const build = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello world\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    if (build.ok === false) throw new Error("expected build to succeed");
    const result = await checkStaleBase(
      build.proposal,
      baseRead({ blobSha: "blob-sha-2", commitSha: "commit-sha-2", content: "changed\n" }),
    );
    expect(result.stale).toBe(true);
    expect(result.reasons).toHaveLength(3);
  });
});

describe("buildApprovalPreview", () => {
  it("includes the diff, repo/path/branch identity, and an explicit no-mutation execution scope", async () => {
    const build = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello world\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    if (build.ok === false) throw new Error("expected build to succeed");
    const preview = buildApprovalPreview(build.proposal);
    expect(preview.previewText).toContain("aryan/smartflow");
    expect(preview.previewText).toContain("README.md");
    expect(preview.previewText).toContain("main");
    expect(preview.diffText).toContain("+hello world");
    expect(preview.addedLineCount).toBe(1);
    expect(preview.removedLineCount).toBe(1);
    expect(preview.executionScope).toMatch(/cannot create a branch/i);
    expect(preview.executionScope).toMatch(/cannot.*create a commit/i);
    expect(preview.executionScope).toMatch(/cannot.*pull request/i);
  });

  it("states plainly when a proposal is a no-op", async () => {
    const build = await buildCodeFileProposal({
      baseRead: baseRead(),
      proposedContent: "hello\n",
      requestId: "request:1",
      stepId: "step:1",
    });
    if (build.ok === false) throw new Error("expected build to succeed");
    const preview = buildApprovalPreview(build.proposal);
    expect(preview.diffText).toContain("no changes");
  });
});
