import { randomUUID } from "node:crypto";
import { assertRepoAllowed } from "./allowlist.js";
import {
  assertNotDefaultBranch,
  ensureWorkspace,
  createTaskBranchFromMain,
  commitAll,
  pushBranch,
  getRemoteDefaultBranchSha,
} from "./git.js";
import { runClaudeCodeTask } from "./claudeCodeRunner.js";
import { verifyTaskResult, detectSelfReportDisagreement } from "./verify.js";

// Fields the public task-input schema does not support in v0. Their mere
// presence is rejected outright — this is the "if the task input ever
// requests targeting main directly, the companion must refuse" requirement,
// generalized: there is no supported way to name a branch at all, so there
// is no way to smuggle "main" through a parameter this code accepts.
const UNSUPPORTED_INPUT_FIELDS = [
  "branch",
  "targetBranch",
  "mergeInto",
  "baseBranchOverride",
  "merge",
];

export class TaskValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function validateTaskInput(input, allowedRepos) {
  if (!input || typeof input !== "object") {
    throw new TaskValidationError("Task input must be an object.", "INVALID_INPUT");
  }
  for (const field of UNSUPPORTED_INPUT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw new TaskValidationError(
        `Field "${field}" is not supported. The companion always creates its own ` +
          `isolated branch off main and never accepts a caller-specified branch or ` +
          `merge target (this includes any attempt to target main).`,
        "MAIN_TARGET_DENIED",
      );
    }
  }
  if (typeof input.taskId !== "string" || input.taskId.length === 0) {
    throw new TaskValidationError("taskId is required.", "INVALID_INPUT");
  }
  if (typeof input.repo !== "string" || input.repo.length === 0) {
    throw new TaskValidationError("repo is required.", "INVALID_INPUT");
  }
  if (typeof input.instruction !== "string" || input.instruction.trim().length === 0) {
    throw new TaskValidationError("instruction is required.", "INVALID_INPUT");
  }
  if (!input.executionIntent || input.executionIntent.confirmed !== true) {
    throw new TaskValidationError(
      "executionIntent.confirmed must be explicitly true. No task runs without explicit execution intent.",
      "EXECUTION_INTENT_MISSING",
    );
  }
  assertRepoAllowed(input.repo, allowedRepos);
}

function generateBranchName(taskId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const shortId = randomUUID().slice(0, 8);
  const safeTaskId = String(taskId).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40);
  const branch = `eng-03-spike-${safeTaskId}-${timestamp}-${shortId}`;
  assertNotDefaultBranch(branch); // structurally impossible to be "main", but asserted anyway
  return branch;
}

/**
 * Runs one full task cycle. Never touches main: the branch is generated
 * here, never supplied by the caller, and every git mutation in git.js
 * independently refuses "main"/"master" before acting.
 *
 * @param {object} deps - injected for testability: { config, lockRegistry, claudeBin override, etc. }
 */
export async function runTask(input, deps) {
  const { config, lockRegistry } = deps;

  validateTaskInput(input, config.allowedRepos);

  const lock = lockRegistry.acquire(input.repo);
  if (!lock.ok) {
    throw new TaskValidationError(
      `A task is already running against ${input.repo}. Concurrent tasks on the same workspace are denied.`,
      "WORKSPACE_BUSY",
    );
  }

  const timeoutSeconds = input.timeoutSeconds || config.defaultTimeoutSeconds;
  const maxBudgetUsd = input.maxBudgetUsd || config.maxBudgetUsd;
  const branchName = generateBranchName(input.taskId);

  try {
    const repoDir = await ensureWorkspace({
      repo: input.repo,
      workspaceRoot: config.workspaceRoot,
      gitRemoteBase: config.gitRemoteBase,
    });
    const defaultBranchShaBefore = await getRemoteDefaultBranchSha(input.repo, config.gitRemoteBase);

    await createTaskBranchFromMain({ repoDir, branchName });

    const claudeCommand = deps.claudeCommand || [config.claudeBin];
    const selfReport = await runClaudeCodeTask({
      cwd: repoDir,
      instruction: input.instruction,
      claudeCommand,
      timeoutSeconds,
      maxBudgetUsd,
    });

    // The companion — not Claude — owns the commit and push. Claude Code was
    // invoked with all `git*` Bash calls denied (claudeCodeRunner.js), so it
    // can only have edited files; it cannot have committed or pushed anything.
    const commitMessage = `ENG-03 companion task ${input.taskId}: ${input.instruction}`.slice(0, 500);
    const newSha = await commitAll({ repoDir, message: commitMessage, branchName });
    if (newSha) {
      await pushBranch({ repoDir, branchName });
    }

    const verified = await verifyTaskResult({
      repo: input.repo,
      repoDir,
      branchName,
      baseRef: "origin/main",
      defaultBranchShaBefore,
      gitRemoteBase: config.gitRemoteBase,
    });

    const disagreement = detectSelfReportDisagreement(selfReport, verified);

    return {
      taskId: input.taskId,
      repo: input.repo,
      branchName,
      selfReport,
      verified,
      disagreement,
    };
  } finally {
    lock.release();
  }
}
