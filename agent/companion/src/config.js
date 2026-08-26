import os from "node:os";
import path from "node:path";

/**
 * ENG-04: companion configuration for the outbound polling loop, replacing
 * ENG-03's inbound-listener config. `port`/`sharedToken` (the old inbound
 * HTTP surface) are gone entirely -- there is nothing left to bind or
 * protect, since the companion no longer listens on anything.
 */
export function loadConfig(env = process.env) {
  const allowedRepos = (env.COMPANION_ALLOWED_REPOS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const workspaceRoot =
    env.COMPANION_WORKSPACE_ROOT ||
    path.join(os.tmpdir(), "smartflow-companion-workspaces");

  const claudeBin = env.COMPANION_CLAUDE_BIN || "claude";

  // Overridable so tests can point at a local bare-repo fixture instead of
  // real GitHub. Production leaves this at the default.
  const gitRemoteBase = env.COMPANION_GIT_REMOTE_BASE || "https://github.com";

  const defaultTimeoutSeconds = Number.parseInt(
    env.COMPANION_DEFAULT_TIMEOUT_SECONDS || "300",
    10,
  );

  const maxBudgetUsd = Number.parseFloat(
    env.COMPANION_MAX_BUDGET_USD || "2",
  );

  // ENG-04: the Worker the companion now polls, and the shared secret that
  // authenticates it there (ENGINEERING_TASKS_COMPANION_TOKEN on the Worker
  // side -- see agent/worker/engineering-tasks-endpoint.ts). Distinct from
  // ENG-03's removed COMPANION_SHARED_TOKEN, which protected an inbound
  // listener that no longer exists.
  const workerBaseUrl = env.COMPANION_WORKER_BASE_URL || null;
  const engineeringTasksToken = env.COMPANION_ENGINEERING_TASKS_TOKEN || null;

  const pollIntervalSeconds = Number.parseInt(
    env.COMPANION_POLL_INTERVAL_SECONDS || "10",
    10,
  );

  // Informational only (sent as `claimedBy`) -- never an authorization
  // fact; the shared token above is what authorizes every call.
  const companionId = env.COMPANION_ID || os.hostname();

  return {
    allowedRepos,
    workspaceRoot,
    claudeBin,
    gitRemoteBase,
    defaultTimeoutSeconds,
    maxBudgetUsd,
    workerBaseUrl,
    engineeringTasksToken,
    pollIntervalSeconds,
    companionId,
  };
}
