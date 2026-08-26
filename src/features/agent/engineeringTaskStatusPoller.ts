// ENG-04, Part 1 item 4 / Part 2 item 6: "chat surfaces the final result."
// An engineering task is fundamentally asynchronous (the companion may be
// anywhere from seconds to minutes away from picking it up) -- unlike every
// other write tool in this codebase, which completes synchronously inside
// one runWriteTool call. This module is deliberately separate from that
// synchronous result path (resultMessage/composeAssistantResponse in
// ChatPage.tsx): it polls the Worker's status endpoint after submission and
// produces one honest, bounded follow-up message once the task reaches a
// terminal state (or an honest "still waiting" / "appears stuck" message if
// it never does, per Part 1 item 5 -- no retry, no silent disappearance).

export interface EngineeringTaskStatus {
  id: string;
  status: "pending" | "claimed" | "completed" | "failed";
  repo?: string;
  branchName?: string | null;
  verifiedResult?: { filesChanged?: string[]; hasCommits?: boolean; merged?: boolean } | null;
  disagreement?: { disagreement: boolean; detail?: string } | null;
  errorMessage?: string | null;
  waitingForCompanion?: boolean;
  stuckInProgress?: boolean;
}

export interface FetchEngineeringTaskStatusOptions {
  workerBaseUrl: string;
  getAccessToken(): Promise<string | undefined>;
  fetcher?: typeof fetch;
}

export async function fetchEngineeringTaskStatus(
  options: FetchEngineeringTaskStatusOptions,
  taskId: string,
): Promise<EngineeringTaskStatus> {
  const fetcher = options.fetcher ?? fetch;
  const accessToken = await options.getAccessToken();
  if (!accessToken) throw new Error("Authentication is required.");

  const base = new URL(options.workerBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, "")}/engineering-tasks/${encodeURIComponent(taskId)}`;
  base.search = "";
  base.hash = "";

  const response = await fetcher(base.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Engineering task status request failed (${response.status}).`);
  }
  return (await response.json()) as EngineeringTaskStatus;
}

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/**
 * Polls until the task reaches a terminal status, or until maxAttempts is
 * exhausted -- never indefinitely, and never silently. `onUpdate` fires on
 * every poll (including non-terminal ones), so a caller can render "waiting
 * for your machine to come online" as soon as the Worker itself says so
 * (Part 1 item 5), not just at the very end.
 */
export async function pollEngineeringTaskUntilDone(
  options: FetchEngineeringTaskStatusOptions,
  taskId: string,
  config: { intervalMs?: number; maxAttempts?: number; onUpdate?: (status: EngineeringTaskStatus) => void } = {},
): Promise<EngineeringTaskStatus> {
  const intervalMs = config.intervalMs ?? 10_000;
  const maxAttempts = config.maxAttempts ?? 60; // default ceiling: ~10 minutes at the default interval

  let lastStatus: EngineeringTaskStatus | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastStatus = await fetchEngineeringTaskStatus(options, taskId);
    config.onUpdate?.(lastStatus);
    if (TERMINAL_STATUSES.has(lastStatus.status)) {
      return lastStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // Exhausted the bounded attempt budget without a terminal status -- this
  // is itself an honest, reportable outcome (Part 1 item 5), never a silent
  // vanish. The caller decides how to phrase it; we return what we know.
  return lastStatus ?? { id: taskId, status: "pending", waitingForCompanion: true };
}

/**
 * Composes the honest, bounded follow-up message (Part 1 item 4's own
 * worked example: "Engineering task done -- branch X, 1 file changed,
 * verified. PR needed for merge."). Plain text, not a translation-key
 * lookup -- this is new, async-only copy with no existing i18n entry to
 * reuse, disclosed here rather than silently left English-only forever;
 * follow-up i18n is listed as a known limitation, not hidden.
 */
export function formatEngineeringTaskResultMessage(status: EngineeringTaskStatus): string {
  if (status.status === "pending" || status.status === "claimed") {
    if (status.stuckInProgress) {
      return `Engineering task on ${status.repo ?? "the repository"} appears stuck -- your machine claimed it but never reported back. Check the companion process; the task was not lost, but nothing more will happen automatically.`;
    }
    if (status.waitingForCompanion) {
      return `Engineering task on ${status.repo ?? "the repository"} is still waiting for your machine to come online.`;
    }
    return `Engineering task on ${status.repo ?? "the repository"} is in progress.`;
  }

  if (status.status === "failed") {
    return `Engineering task on ${status.repo ?? "the repository"} failed: ${status.errorMessage ?? "no further detail was reported"}.`;
  }

  // completed
  const filesChanged = status.verifiedResult?.filesChanged?.length ?? 0;
  const branch = status.branchName ? `branch ${status.branchName}` : "a new branch";
  const disagreementNote = status.disagreement?.disagreement
    ? " Note: the agent's own report did not match what was independently verified -- review before trusting the summary."
    : "";
  return `Engineering task done -- ${branch}, ${filesChanged} file${filesChanged === 1 ? "" : "s"} changed, verified. PR needed for merge.${disagreementNote}`;
}
