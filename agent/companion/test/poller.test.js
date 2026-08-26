import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pollOnce, claimPendingTask, startPollingLoop } from "../src/poller.js";
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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "companion-poller-test-ws-"));
  cleanups.push(() => fs.rm(workspaceRoot, { recursive: true, force: true }));

  const config = {
    allowedRepos: [origin.repo],
    workspaceRoot,
    claudeBin: "unused-in-tests",
    gitRemoteBase: origin.gitRemoteBase,
    defaultTimeoutSeconds: 10,
    maxBudgetUsd: 2,
    workerBaseUrl: "https://worker.example",
    engineeringTasksToken: "companion-secret",
    pollIntervalSeconds: 0.01,
    companionId: "test-companion",
    ...overrides,
  };
  return { origin, config };
}

function fetcherReturning(responses) {
  let call = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
  });
}

describe("claimPendingTask", () => {
  it("sends the companion token and companionId, returns null when nothing pending", async () => {
    const fetcher = fetcherReturning([{ body: { task: null } }]);
    const config = { workerBaseUrl: "https://worker.example", engineeringTasksToken: "secret", companionId: "c1" };
    const task = await claimPendingTask(config, { fetcher });
    expect(task).toBeNull();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain("/engineering-tasks/pending");
    expect(url).toContain("claimedBy=c1");
    expect(init.headers["X-Companion-Token"]).toBe("secret");
  });

  it("throws when the Worker is unreachable/unhealthy (offline-Worker case)", async () => {
    const fetcher = fetcherReturning([{ ok: false, status: 503, body: {} }]);
    const config = { workerBaseUrl: "https://worker.example", engineeringTasksToken: "secret", companionId: "c1" };
    await expect(claimPendingTask(config, { fetcher })).rejects.toThrow(/503/);
  });
});

describe("pollOnce", () => {
  it("returns claimed: false when there is nothing pending, without touching taskRunner", async () => {
    const { config } = await setupOriginAndConfig();
    const fetcher = fetcherReturning([{ body: { task: null } }]);
    const outcome = await pollOnce(config, { fetcher, lockRegistry: new WorkspaceLockRegistry() });
    expect(outcome).toEqual({ claimed: false });
  });

  it("denies and reports a claimed task whose repo is not on this companion's own allowlist", async () => {
    const { config } = await setupOriginAndConfig();
    const reportCalls = [];
    const fetcher = vi.fn(async (url, init) => {
      if (String(url).includes("/pending")) {
        return { ok: true, json: async () => ({ task: { id: "t1", repo: "someone-else/not-allowed", instruction: "x", taskClass: "docs_fix" } }) };
      }
      reportCalls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    });
    const outcome = await pollOnce(config, { fetcher, lockRegistry: new WorkspaceLockRegistry() });
    expect(outcome).toEqual({ claimed: true, taskId: "t1", ok: false, reason: "repo_not_allowed" });
    expect(reportCalls).toHaveLength(1);
    const reportBody = JSON.parse(reportCalls[0].init.body);
    expect(reportBody.ok).toBe(false);
    expect(reportBody.errorMessage).toMatch(/not on this companion's allowlist/);
  }, 20_000);

  it("claims, runs, and reports a successful task end to end (real local-repo taskRunner pipeline, fake claude)", async () => {
    const { origin, config } = await setupOriginAndConfig();
    const reportCalls = [];
    const fetcher = vi.fn(async (url, init) => {
      if (String(url).includes("/pending")) {
        return { ok: true, json: async () => ({ task: { id: "t1", repo: origin.repo, instruction: "add a note", taskClass: "docs_fix" } }) };
      }
      reportCalls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    });

    const outcome = await pollOnce(config, {
      fetcher,
      lockRegistry: new WorkspaceLockRegistry(),
      claudeCommand: fakeClaude("fakeClaudeSuccess.js"),
    });

    expect(outcome).toEqual({ claimed: true, taskId: "t1", ok: true });
    expect(reportCalls).toHaveLength(1);
    expect(String(reportCalls[0].url)).toContain("/engineering-tasks/t1/report");
    expect(reportCalls[0].init.headers["X-Companion-Token"]).toBe("companion-secret");
    const reportBody = JSON.parse(reportCalls[0].init.body);
    expect(reportBody.ok).toBe(true);
    expect(reportBody.verified.hasCommits).toBe(true);
    expect(reportBody.verified.defaultBranchUnchanged).toBe(true);
    expect(reportBody.disagreement.disagreement).toBe(false);
  }, 20_000);

  it("reports ok: false with an honest error message when taskRunner throws (e.g. a bug or unexpected git failure)", async () => {
    const { config } = await setupOriginAndConfig({ allowedRepos: ["some/repo-that-does-not-exist-locally"] });
    const reportCalls = [];
    const fetcher = vi.fn(async (url, init) => {
      if (String(url).includes("/pending")) {
        return { ok: true, json: async () => ({ task: { id: "t1", repo: "some/repo-that-does-not-exist-locally", instruction: "x", taskClass: "docs_fix" } }) };
      }
      reportCalls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    });

    const outcome = await pollOnce(config, { fetcher, lockRegistry: new WorkspaceLockRegistry() });
    expect(outcome.claimed).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("task_runner_threw");
    const reportBody = JSON.parse(reportCalls[0].init.body);
    expect(reportBody.ok).toBe(false);
    expect(typeof reportBody.errorMessage).toBe("string");
  }, 20_000);

  it("redacts secret-shaped content from the report body before it is sent", async () => {
    const { origin, config } = await setupOriginAndConfig();
    const reportCalls = [];
    const fetcher = vi.fn(async (url, init) => {
      if (String(url).includes("/pending")) {
        return { ok: true, json: async () => ({ task: { id: "t1", repo: origin.repo, instruction: "x", taskClass: "docs_fix" } }) };
      }
      reportCalls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    });
    await pollOnce(config, { fetcher, lockRegistry: new WorkspaceLockRegistry(), claudeCommand: fakeClaude("fakeClaudeSecretLeak.js") });
    const raw = reportCalls[0].init.body;
    expect(raw).not.toContain("ghp_");
  }, 20_000);
});

describe("startPollingLoop", () => {
  it("survives a poll-cycle failure (Worker unreachable) and keeps polling on the next tick", async () => {
    const { config } = await setupOriginAndConfig();
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("network down");
      return { ok: true, json: async () => ({ task: null }) };
    });
    const ticks = [];
    const controller = new AbortController();
    const loopPromise = startPollingLoop(config, { fetcher, lockRegistry: new WorkspaceLockRegistry() }, {
      signal: controller.signal,
      onTick: (outcome) => {
        ticks.push(outcome);
        if (ticks.length >= 2) controller.abort();
      },
    });
    await loopPromise;
    expect(ticks[0].error).toMatch(/network down/);
    expect(ticks[1]).toEqual({ claimed: false });
  });
});

describe("no inbound listener remains", () => {
  it("no companion source file opens a listening socket", async () => {
    const srcDir = path.join(__dirname, "..", "src");
    const files = await fs.readdir(srcDir);
    for (const file of files) {
      const content = await fs.readFile(path.join(srcDir, file), "utf-8");
      expect(content, `${file} must not create an HTTP/net server`).not.toMatch(/createServer|\.listen\(/);
    }
  });

  it("server.js (ENG-03's inbound listener) no longer exists", async () => {
    const srcDir = path.join(__dirname, "..", "src");
    const files = await fs.readdir(srcDir);
    expect(files).not.toContain("server.js");
  });
});
