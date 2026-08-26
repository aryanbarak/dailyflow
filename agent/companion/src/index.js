import { loadConfig } from "./config.js";
import { startPollingLoop } from "./poller.js";
import { WorkspaceLockRegistry } from "./workspaceLock.js";

const config = loadConfig();

// ENG-04: no port to bind, no listener to start -- the companion only ever
// initiates outbound requests to the Worker (see poller.js). Fail closed on
// missing config exactly as ENG-03's server did for its own required env
// vars.
if (config.allowedRepos.length === 0) {
  console.error(
    "COMPANION_ALLOWED_REPOS is empty. Refusing to start with no repository allowlist.",
  );
  process.exit(1);
}
if (!config.workerBaseUrl) {
  console.error(
    "COMPANION_WORKER_BASE_URL is not set. The companion has nothing to poll.",
  );
  process.exit(1);
}
if (!config.engineeringTasksToken) {
  console.error(
    "COMPANION_ENGINEERING_TASKS_TOKEN is not set. Refusing to start without a required request credential.",
  );
  process.exit(1);
}

const lockRegistry = new WorkspaceLockRegistry();

console.log(`SmartFlow coding companion (ENG-04) polling ${config.workerBaseUrl} every ${config.pollIntervalSeconds}s`);
console.log(`Allowed repositories: ${config.allowedRepos.join(", ")}`);
console.log(`Workspace root: ${config.workspaceRoot}`);
console.log(`Claude Code binary: ${config.claudeBin}`);
console.log(`Companion id: ${config.companionId}`);
console.log("No inbound port is opened by this process.");

startPollingLoop(config, { lockRegistry }, {
  onTick: (outcome) => {
    if (outcome.error) {
      console.error(`[companion] poll error: ${outcome.error}`);
    } else if (outcome.claimed) {
      console.log(`[companion] task ${outcome.taskId} finished (ok=${outcome.ok}${outcome.reason ? `, reason=${outcome.reason}` : ""})`);
    }
  },
});
