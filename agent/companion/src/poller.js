// ENG-04: replaces ENG-03's inbound HTTP listener (server.js, removed) with
// an outbound polling loop, per the non-negotiable security constraint: the
// companion, running on the PO's own machine, must never expose an inbound
// port reachable from anywhere. It only ever initiates outbound HTTPS
// requests to the Worker. taskRunner.js (the actual git/Claude Code
// pipeline) is called completely unchanged from ENG-03 -- this module only
// adds "how does a task get here" and "where does the result go."

import { runTask } from "./taskRunner.js";
import { redactSecretsDeep } from "./secretRedaction.js";

function defaultFetcher(input, init) {
  return fetch(input, init);
}

/** Asks the Worker for one pending task. Returns null if there is none. */
export async function claimPendingTask(config, deps) {
  const fetcher = deps.fetcher || defaultFetcher;
  const url = `${config.workerBaseUrl}/engineering-tasks/pending?claimedBy=${encodeURIComponent(config.companionId)}`;
  const res = await fetcher(url, {
    method: "GET",
    headers: { "X-Companion-Token": config.engineeringTasksToken },
  });
  if (!res.ok) {
    throw new Error(`Worker returned ${res.status} while polling for pending tasks.`);
  }
  const body = await res.json();
  return body.task || null;
}

/** Posts the finished task's self-report + verified result back to the Worker. */
export async function postReport(config, taskId, report, deps) {
  const fetcher = deps.fetcher || defaultFetcher;
  const url = `${config.workerBaseUrl}/engineering-tasks/${encodeURIComponent(taskId)}/report`;
  const res = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Companion-Token": config.engineeringTasksToken,
    },
    body: JSON.stringify(redactSecretsDeep(report)),
  });
  if (!res.ok) {
    throw new Error(`Worker returned ${res.status} while posting the task report.`);
  }
}

/**
 * One full poll cycle: claim -> (if claimed) run -> report. Returns a
 * small, structured outcome for logging/testing -- never throws for an
 * ordinary "nothing to do" or "task failed" outcome; only a genuine
 * transport/Worker failure propagates, so the caller's loop can distinguish
 * "the Worker is unreachable, back off" from "a task legitimately failed."
 *
 * @param {object} config
 * @param {{fetcher?: typeof fetch, lockRegistry: import('./workspaceLock.js').WorkspaceLockRegistry, claudeCommand?: string[]}} deps
 */
export async function pollOnce(config, deps) {
  const task = await claimPendingTask(config, deps);
  if (!task) {
    return { claimed: false };
  }

  // Defense in depth (authority-model.md's "no hidden execution" / "fail
  // closed" spirit, applied here): the companion does not blindly trust
  // that whatever repo the Worker/Supabase handed back is safe to act on --
  // it independently re-checks its OWN allowlist before running anything,
  // exactly as it already did for ENG-03's inbound path.
  if (!config.allowedRepos.includes(task.repo)) {
    await postReport(config, task.id, {
      ok: false,
      errorMessage: `Repository "${task.repo}" is not on this companion's allowlist.`,
    }, deps);
    return { claimed: true, taskId: task.id, ok: false, reason: "repo_not_allowed" };
  }

  const taskRunnerDeps = { config, lockRegistry: deps.lockRegistry };
  if (deps.claudeCommand) taskRunnerDeps.claudeCommand = deps.claudeCommand;

  try {
    const result = await runTask(
      {
        taskId: task.id,
        repo: task.repo,
        instruction: task.instruction,
        // The approval already happened before the Worker ever created this
        // pending row (ENG-04's whole point) -- the companion is not
        // deciding to approve anything here, only passing through an
        // already-approved instruction into taskRunner.js's own required
        // execution-intent gate.
        executionIntent: { confirmed: true },
        timeoutSeconds: config.defaultTimeoutSeconds,
        maxBudgetUsd: config.maxBudgetUsd,
      },
      taskRunnerDeps,
    );

    await postReport(config, task.id, {
      ok: result.selfReport.ok && !result.disagreement.disagreement,
      selfReport: result.selfReport,
      verified: result.verified,
      disagreement: result.disagreement,
      branchName: result.branchName,
    }, deps);

    return { claimed: true, taskId: task.id, ok: result.selfReport.ok };
  } catch (error) {
    await postReport(config, task.id, {
      ok: false,
      errorMessage: error.message,
    }, deps);
    return { claimed: true, taskId: task.id, ok: false, reason: "task_runner_threw" };
  }
}

/**
 * The actual long-running loop. Never exits on an ordinary polling failure
 * (e.g. the Worker being temporarily unreachable) -- logs and keeps going,
 * so a transient network blip never requires a manual restart.
 */
export function startPollingLoop(config, deps, { onTick, signal } = {}) {
  let stopped = false;
  if (signal) signal.addEventListener("abort", () => { stopped = true; });

  async function loop() {
    while (!stopped) {
      try {
        const outcome = await pollOnce(config, deps);
        if (onTick) onTick(outcome);
      } catch (error) {
        console.error(`[companion] poll cycle failed (will retry): ${error.message}`);
        if (onTick) onTick({ claimed: false, error: error.message });
      }
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalSeconds * 1000));
    }
  }

  return loop();
}
