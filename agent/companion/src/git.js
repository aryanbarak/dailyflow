import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFile = promisify(execFileCb);

const DEFAULT_BRANCH_NAMES = new Set(["main", "master"]);
const GIT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 20 * 1024 * 1024;

/**
 * Structural guard, checked before every checkout/commit/push call in this
 * module — mirrors ADR-0005 Decision 3's "the code path never constructs a
 * request that writes to refs/heads/<default>" for GitHub file mutation,
 * applied here to plain git branch operations.
 */
export function assertNotDefaultBranch(branchName) {
  const normalized = String(branchName || "").trim().toLowerCase();
  if (!normalized || DEFAULT_BRANCH_NAMES.has(normalized)) {
    const err = new Error(
      `Refusing to operate on the default/protected branch name: "${branchName}"`,
    );
    err.code = "DEFAULT_BRANCH_DENIED";
    throw err;
  }
}

export function repoSlug(repo) {
  return repo.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function remoteUrlFor(repo, gitRemoteBase = "https://github.com") {
  // A test fixture may pass a full local path/URL as gitRemoteBase and a
  // bare repo directory (no ".git" suffix needed) as `repo`; production
  // defaults to GitHub's owner/name.git convention.
  if (gitRemoteBase.startsWith("file://") || gitRemoteBase.startsWith("/") || /^[A-Za-z]:[\\/]/.test(gitRemoteBase)) {
    return `${gitRemoteBase}/${repo}`;
  }
  return `${gitRemoteBase}/${repo}.git`;
}

/**
 * Minimal env for git/gh child processes: an allowlist, not a blocklist, so
 * a stray API key sitting in the parent shell's env can never reach a git
 * subprocess by accident. Git's own credential helper (configured ambiently
 * via `gh auth login` on this machine) still works with this minimal set.
 */
function safeGitEnv() {
  const keep = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "ProgramFiles",
    "ComSpec",
    "GIT_ASKPASS",
  ];
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of keep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function git(args, cwd) {
  return execFile("git", args, {
    cwd,
    env: safeGitEnv(),
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Clones the repo if the workspace doesn't exist yet, otherwise fetches. */
export async function ensureWorkspace({ repo, workspaceRoot, gitRemoteBase }) {
  await fs.mkdir(workspaceRoot, { recursive: true });
  const repoDir = path.join(workspaceRoot, repoSlug(repo));
  const gitDir = path.join(repoDir, ".git");

  if (await pathExists(gitDir)) {
    await git(["fetch", "origin", "main"], repoDir);
  } else {
    await git(["clone", remoteUrlFor(repo, gitRemoteBase), repoDir], workspaceRoot);
  }
  return repoDir;
}

/**
 * Creates (or resets) the task branch directly from origin/main's tip.
 * Deliberately never checks out a local "main"/"master" ref at any point —
 * the working directory only ever holds the freshly created task branch.
 */
export async function createTaskBranchFromMain({ repoDir, branchName }) {
  assertNotDefaultBranch(branchName);
  await git(["fetch", "origin", "main"], repoDir);
  await git(["checkout", "-B", branchName, "origin/main"], repoDir);
}

export async function getStatusPorcelain(repoDir) {
  const { stdout } = await git(["status", "--porcelain"], repoDir);
  return stdout;
}

export async function hasUncommittedChanges(repoDir) {
  const status = await getStatusPorcelain(repoDir);
  return status.trim().length > 0;
}

/** Commits all working-tree changes. Returns the new commit SHA, or null if there was nothing to commit. */
export async function commitAll({ repoDir, message, branchName }) {
  assertNotDefaultBranch(branchName);
  const current = await getCurrentBranch(repoDir);
  if (current !== branchName) {
    const err = new Error(
      `Refusing to commit: expected to be on "${branchName}" but HEAD is on "${current}"`,
    );
    err.code = "UNEXPECTED_BRANCH";
    throw err;
  }
  if (!(await hasUncommittedChanges(repoDir))) {
    return null;
  }
  await git(["add", "-A"], repoDir);
  await git(["commit", "-m", message], repoDir);
  return getHeadSha(repoDir);
}

export async function pushBranch({ repoDir, branchName }) {
  assertNotDefaultBranch(branchName);
  const current = await getCurrentBranch(repoDir);
  if (current !== branchName) {
    const err = new Error(
      `Refusing to push: expected to be on "${branchName}" but HEAD is on "${current}"`,
    );
    err.code = "UNEXPECTED_BRANCH";
    throw err;
  }
  await git(["push", "-u", "origin", `${branchName}:${branchName}`], repoDir);
}

export async function getHeadSha(repoDir) {
  const { stdout } = await git(["rev-parse", "HEAD"], repoDir);
  return stdout.trim();
}

export async function getCurrentBranch(repoDir) {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], repoDir);
  return stdout.trim();
}

export async function getChangedFiles({ repoDir, baseRef }) {
  const { stdout } = await git(["diff", "--name-only", `${baseRef}...HEAD`], repoDir);
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function getCommitsSince({ repoDir, baseRef }) {
  const { stdout } = await git(["log", "--oneline", `${baseRef}..HEAD`], repoDir);
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Returns the remote SHA for a branch, or null if the branch doesn't exist remotely. */
export async function getRemoteBranchSha({ repo, branchName, gitRemoteBase }) {
  const { stdout } = await execFile(
    "git",
    ["ls-remote", remoteUrlFor(repo, gitRemoteBase), `refs/heads/${branchName}`],
    { env: safeGitEnv(), timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
  );
  const line = stdout.split("\n").find(Boolean);
  if (!line) return null;
  return line.split("\t")[0].trim();
}

export async function getRemoteDefaultBranchSha(repo, gitRemoteBase) {
  const sha = await getRemoteBranchSha({ repo, branchName: "main", gitRemoteBase });
  if (!sha) {
    const err = new Error(`Could not resolve remote main for ${repo}`);
    err.code = "REMOTE_MAIN_UNRESOLVED";
    throw err;
  }
  return sha;
}
