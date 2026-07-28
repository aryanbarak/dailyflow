import { describe, expect, it } from "vitest";
import {
  buildCodeProposalBinding,
  CODE_PROPOSAL_APPROVAL_TTL_MS,
  validateCodeProposalApproval,
} from "./codeProposalApproval";
import { buildCodeFileProposal, computeProposalId } from "./codeProposalBuilder";
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

async function proposal(overrides: Partial<CodeFileReadResult> = {}, proposedContent = "hello world\n") {
  const result = await buildCodeFileProposal({
    baseRead: baseRead(overrides),
    proposedContent,
    requestId: "request:1",
    stepId: "step:1",
  });
  if (result.ok === false) throw new Error("expected proposal build to succeed");
  return result.proposal;
}

describe("buildCodeProposalBinding", () => {
  it("binds the exact proposal identifiers and sets expiresAt to +15 minutes", async () => {
    const built = await proposal();
    const currentTime = new Date("2026-07-28T10:00:00.000Z");
    const binding = buildCodeProposalBinding(built, currentTime);

    expect(binding).toEqual({
      repo: "aryan/smartflow",
      path: "README.md",
      baseBlobSha: "blob-sha-1",
      baseCommitSha: "commit-sha-1",
      proposedContentDigest: built.proposedContentDigest,
      proposalId: built.proposalId,
      expiresAt: "2026-07-28T10:15:00.000Z",
    });
    expect(CODE_PROPOSAL_APPROVAL_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe("validateCodeProposalApproval", () => {
  const currentTime = new Date("2026-07-28T10:00:00.000Z");

  it("accepts a valid, unexpired, unchanged code proposal binding", async () => {
    const built = await proposal();
    const binding = buildCodeProposalBinding(built, currentTime);

    const result = validateCodeProposalApproval({ binding, proposal: built, currentTime });

    expect(result).toEqual({ valid: true, reasons: [] });
  });

  it("rejects a proposal id mismatch", async () => {
    const built = await proposal();
    const binding = buildCodeProposalBinding(built, currentTime);
    const differentId = await computeProposalId({
      repo: built.repo,
      path: built.path,
      baseBlobSha: built.baseBlobSha,
      baseCommitSha: built.baseCommitSha,
      proposedContentDigest: "0".repeat(64),
    });

    const result = validateCodeProposalApproval({
      binding: { ...binding, proposalId: differentId },
      proposal: built,
      currentTime,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("proposal_id_mismatch");
  });

  it("rejects a base blob SHA mismatch (the file changed on GitHub since approval)", async () => {
    const built = await proposal();
    const binding = buildCodeProposalBinding(built, currentTime);
    const changedUpstream = await proposal({ blobSha: "blob-sha-2" });

    const result = validateCodeProposalApproval({ binding, proposal: changedUpstream, currentTime });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("blob_sha_mismatch");
    // A blob SHA change also changes the content-addressed proposal id --
    // both reasons are reported, not just one.
    expect(result.reasons).toContain("proposal_id_mismatch");
  });

  it("rejects a proposed content digest mismatch", async () => {
    const built = await proposal();
    const binding = buildCodeProposalBinding(built, currentTime);
    const differentContent = await proposal({}, "a different proposed body\n");

    const result = validateCodeProposalApproval({ binding, proposal: differentContent, currentTime });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("content_digest_mismatch");
  });

  it("rejects an expired approval even when nothing else changed", async () => {
    const built = await proposal();
    const binding = buildCodeProposalBinding(built, currentTime);
    const oneMillisecondAfterExpiry = new Date(
      new Date(binding.expiresAt).getTime() + 1,
    );

    const result = validateCodeProposalApproval({
      binding,
      proposal: built,
      currentTime: oneMillisecondAfterExpiry,
    });

    expect(result).toEqual({ valid: false, reasons: ["approval_expired"] });
  });

  it("accepts an approval validated at exactly the expiry instant", async () => {
    const built = await proposal();
    const binding = buildCodeProposalBinding(built, currentTime);

    const result = validateCodeProposalApproval({
      binding,
      proposal: built,
      currentTime: new Date(binding.expiresAt),
    });

    expect(result).toEqual({ valid: true, reasons: [] });
  });

  it("rejects a stale approval: the branch moved to a new commit since approval", async () => {
    const built = await proposal();
    const binding = buildCodeProposalBinding(built, currentTime);
    const staleBase = await proposal({ commitSha: "commit-sha-2" });

    const result = validateCodeProposalApproval({ binding, proposal: staleBase, currentTime });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("commit_sha_mismatch");
  });

  it("reports every simultaneous reason rather than short-circuiting on the first", async () => {
    const built = await proposal();
    const binding = buildCodeProposalBinding(built, currentTime);
    const everythingChanged = await proposal(
      { blobSha: "blob-sha-9", commitSha: "commit-sha-9" },
      "totally different content\n",
    );
    const afterExpiry = new Date(new Date(binding.expiresAt).getTime() + 1);

    const result = validateCodeProposalApproval({
      binding,
      proposal: everythingChanged,
      currentTime: afterExpiry,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "proposal_id_mismatch",
        "blob_sha_mismatch",
        "commit_sha_mismatch",
        "content_digest_mismatch",
        "approval_expired",
      ]),
    );
    expect(result.reasons).toHaveLength(5);
  });
});
