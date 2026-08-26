import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTask } from "../src/taskRunner.js";
import { WorkspaceLockRegistry } from "../src/workspaceLock.js";
import { createLocalOrigin } from "./fixtures/localOrigin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");

function fakeClaude(scriptName) {
  return [process.execPath, path.join(fixturesDir, scriptName)];
}

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop();
    await fn().catch(() => {});
  }
});

async function setupOriginAndConfig(overrides = {}) {
  const origin = await createLocalOrigin();
  cleanups.push(origin.cleanup);

  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "companion-test-ws-"));
  cleanups.push(() => fs.rm(workspaceRoot, { recursive: true, force: true }));

  const config = {
    allowedRepos: [origin.repo],
    workspaceRoot,
    claudeBin: "unused-in-tests",
    gitRemoteBase: origin.gitRemoteBase,
    defaultTimeoutSeconds: 10,
    maxBudgetUsd: 2,
    sharedToken: null,
    ...overrides,
  };

  return { origin, config, lockRegistry: new WorkspaceLockRegistry() };
}

describe("runTask: input validation", () => {
  it("rejects a task missing explicit execution intent", async () => {
    const { origin, config, lockRegistry } = await setupOriginAndConfig();
    await expect(
      runTask(
        { taskId: "t1", repo: origin.repo, instruction: "do something" },
        { config, lockRegistry },
      ),
    ).rejects.toThrow(/execution intent/i);
  });

  it("rejects a repository not on the allowlist", async () => {
    const { config, lockRegistry } = await setupOriginAndConfig();
    await expect(
      runTask(
        {
          taskId: "t1",
          repo: "someone-else/not-allowed",
          instruction: "do something",
          executionIntent: { confirmed: true },
        },
        { config, lockRegistry },
      ),
    ).rejects.toThrow(/not on the allowlist/i);
  });

  it("refuses a request that names main/master as a target at all", async () => {
    const { origin, config, lockRegistry } = await setupOriginAndConfig();
    await expect(
      runTask(
        {
          taskId: "t1",
          repo: origin.repo,
          instruction: "do something",
          executionIntent: { confirmed: true },
          targetBranch: "main",
        },
        { config, lockRegistry },
      ),
    ).rejects.toMatchObject({ code: "MAIN_TARGET_DENIED" });
  });
});

describe("runTask: concurrency", () => {
  it("denies a second task against the same repo while one is in flight", async () => {
    const { origin, config, lockRegistry } = await setupOriginAndConfig();
    const claudeCommand = fakeClaude("fakeClaudeSuccess.js");

    const first = runTask(
      { taskId: "t1", repo: origin.repo, instruction: "add a note", executionIntent: { confirmed: true } },
      { config, lockRegistry, claudeCommand },
    );

    // Fired while the first task's lock is already held (synchronous prefix
    // of runTask acquires the lock before any await), so this must reject
    // immediately with WORKSPACE_BUSY rather than queue.
    await expect(
      runTask(
        { taskId: "t2", repo: origin.repo, instruction: "add another note", executionIntent: { confirmed: true } },
        { config, lockRegistry, claudeCommand },
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_BUSY" });

    await first; // let the first task finish cleanly before test teardown
  }, 20_000);
});

describe("runTask: Claude Code outcomes", () => {
  it("reports a timeout without touching main", async () => {
    const { origin, config, lockRegistry } = await setupOriginAndConfig();
    const result = await runTask(
      {
        taskId: "t-timeout",
        repo: origin.repo,
        instruction: "hang forever",
        executionIntent: { confirmed: true },
        timeoutSeconds: 1,
      },
      { config, lockRegistry, claudeCommand: fakeClaude("fakeClaudeHang.js") },
    );

    expect(result.selfReport.ok).toBe(false);
    expect(result.selfReport.timedOut).toBe(true);
    expect(result.verified.defaultBranchUnchanged).toBe(true);
    expect(result.verified.hasCommits).toBe(false);
  }, 15_000);

  it("reports Claude Code process failure without a false success claim", async () => {
    const { origin, config, lockRegistry } = await setupOriginAndConfig();
    const result = await runTask(
      { taskId: "t-fail", repo: origin.repo, instruction: "do it", executionIntent: { confirmed: true } },
      { config, lockRegistry, claudeCommand: fakeClaude("fakeClaudeFail.js") },
    );

    expect(result.selfReport.ok).toBe(false);
    expect(result.verified.hasCommits).toBe(false);
    expect(result.disagreement.disagreement).toBe(false); // both sides agree: nothing happened
  }, 20_000);

  it("flags disagreement when the backend claims success but ground truth shows nothing changed", async () => {
    const { origin, config, lockRegistry } = await setupOriginAndConfig();
    const result = await runTask(
      { taskId: "t-noop", repo: origin.repo, instruction: "do it", executionIntent: { confirmed: true } },
      { config, lockRegistry, claudeCommand: fakeClaude("fakeClaudeNoop.js") },
    );

    expect(result.selfReport.ok).toBe(true);
    expect(result.verified.hasCommits).toBe(false);
    expect(result.disagreement.disagreement).toBe(true);
  }, 20_000);

  it("redacts secret-shaped content from the self-report", async () => {
    const { origin, config, lockRegistry } = await setupOriginAndConfig();
    const result = await runTask(
      { taskId: "t-secret", repo: origin.repo, instruction: "do it", executionIntent: { confirmed: true } },
      { config, lockRegistry, claudeCommand: fakeClaude("fakeClaudeSecretLeak.js") },
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ghp_");
    expect(serialized).toContain("[redacted]");
  }, 20_000);

  it("completes a real successful task end to end on an isolated branch, main untouched", async () => {
    const { origin, config, lockRegistry } = await setupOriginAndConfig();
    const result = await runTask(
      {
        taskId: "t-success",
        repo: origin.repo,
        instruction: "add a note explaining the repo",
        executionIntent: { confirmed: true },
      },
      { config, lockRegistry, claudeCommand: fakeClaude("fakeClaudeSuccess.js") },
    );

    expect(result.branchName.startsWith("eng-03-spike-")).toBe(true);
    expect(result.selfReport.ok).toBe(true);
    expect(result.verified.isOnExpectedBranch).toBe(true);
    expect(result.verified.hasCommits).toBe(true);
    expect(result.verified.filesChanged).toContain("NOTE.md");
    expect(result.verified.pushed).toBe(true);
    expect(result.verified.pushedShaMatchesLocalHead).toBe(true);
    expect(result.verified.defaultBranchUnchanged).toBe(true);
    expect(result.disagreement.disagreement).toBe(false);
  }, 20_000);
});
