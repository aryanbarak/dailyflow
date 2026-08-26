import {
  getHeadSha,
  getCurrentBranch,
  getChangedFiles,
  getCommitsSince,
  getRemoteBranchSha,
} from "./git.js";

/**
 * Computes ground truth independently of anything Claude Code (or the
 * companion's own commit step) claimed happened. This is the record the PO
 * actually reviews — it is built from git/GitHub facts, never from a
 * backend's self-report. Mirrors authority-model.md's "runtime truth is
 * authoritative... audit MUST NOT be fabricated from model claims",
 * extended to cover the coding agent's own report as well (see ENG-02 §2/§5).
 */
export async function verifyTaskResult({
  repo,
  repoDir,
  branchName,
  baseRef,
  defaultBranchShaBefore,
  gitRemoteBase,
}) {
  const currentBranch = await getCurrentBranch(repoDir);
  const headSha = await getHeadSha(repoDir);
  const filesChanged = await getChangedFiles({ repoDir, baseRef });
  const commits = await getCommitsSince({ repoDir, baseRef });
  const remoteBranchSha = await getRemoteBranchSha({ repo, branchName, gitRemoteBase });
  const defaultBranchShaAfter = await getRemoteBranchSha({ repo, branchName: "main", gitRemoteBase });

  return {
    currentBranch,
    isOnExpectedBranch: currentBranch === branchName,
    headSha,
    filesChanged,
    commitsCreated: commits,
    hasCommits: commits.length > 0,
    pushed: remoteBranchSha !== null,
    remoteBranchSha,
    pushedShaMatchesLocalHead: remoteBranchSha === headSha,
    defaultBranchShaBefore,
    defaultBranchShaAfter,
    defaultBranchUnchanged: defaultBranchShaBefore === defaultBranchShaAfter,
  };
}

/**
 * Compares the backend's own claim ("ok") against verified ground truth and
 * flags disagreement. Disagreement is itself a reportable, first-class
 * outcome — never silently resolved in either direction.
 */
export function detectSelfReportDisagreement(selfReport, verified) {
  const claimedSuccess = selfReport.ok === true;
  const verifiedSuccess =
    verified.isOnExpectedBranch &&
    verified.hasCommits &&
    verified.pushed &&
    verified.pushedShaMatchesLocalHead &&
    verified.defaultBranchUnchanged;

  if (claimedSuccess === verifiedSuccess) {
    return { disagreement: false };
  }

  return {
    disagreement: true,
    detail: claimedSuccess
      ? "Backend self-reported success, but independent verification did not confirm a pushed commit on the expected branch."
      : "Backend self-reported failure, but independent verification found a pushed commit on the expected branch.",
  };
}
