import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { redactSecrets } from "./secretRedaction.js";

const execFile = promisify(execFileCb);
const MAX_BUFFER = 20 * 1024 * 1024;

/**
 * Minimal, explicit env for the Claude Code subprocess: an allowlist, not
 * process.env spread. Claude Code on this machine authenticates via its own
 * local OAuth/keychain state (confirmed: no ANTHROPIC_API_KEY is set), so
 * no API credential needs to reach this process at all. This also keeps
 * unrelated ambient secrets (e.g. other services' API keys sitting in the
 * parent shell) out of the coding agent's process entirely.
 */
function safeClaudeEnv() {
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
  ];
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of keep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

/**
 * Runs Claude Code non-interactively, in the given working directory, with
 * git entirely denied (the companion — not Claude — owns all git mutation;
 * see git.js). Returns the backend's own self-report. Callers MUST treat
 * this as advisory only and independently verify (see verify.js) — this
 * function does not and cannot establish ground truth by itself.
 *
 * `claudeCommand` is an executable-plus-leading-args array (e.g. `["claude"]`
 * in production, or `[process.execPath, "/path/to/fixture.js"]` in tests) so
 * tests can substitute a fake, free, deterministic "claude" without any
 * change to this function's real-invocation logic.
 *
 * @param {{cwd: string, instruction: string, claudeCommand: string[], timeoutSeconds: number, maxBudgetUsd: number}} opts
 */
export async function runClaudeCodeTask({
  cwd,
  instruction,
  claudeCommand,
  timeoutSeconds,
  maxBudgetUsd,
}) {
  const [claudeBin, ...leadingArgs] = claudeCommand;
  const args = [
    ...leadingArgs,
    "-p",
    instruction,
    "--output-format",
    "json",
    "--permission-mode",
    "bypassPermissions",
    // The companion owns all git mutation deterministically (git.js).
    // Claude Code may read/edit files and run build/test commands, but
    // every git subcommand is hard-denied regardless of permission mode —
    // deny rules are evaluated before permission mode in Claude Code's own
    // permission pipeline, so this is not merely a prompt-level request.
    "--disallowedTools",
    "Bash(git*)",
    "--max-budget-usd",
    String(maxBudgetUsd),
  ];

  const startedAt = Date.now();
  let raw;
  try {
    raw = await execFile(claudeBin, args, {
      cwd,
      env: safeClaudeEnv(),
      timeout: timeoutSeconds * 1000,
      killSignal: "SIGTERM",
      maxBuffer: MAX_BUFFER,
    });
  } catch (err) {
    const wallClockSeconds = (Date.now() - startedAt) / 1000;
    const timedOut = err.killed === true || err.signal === "SIGTERM";
    return {
      id: "claude-code",
      ok: false,
      timedOut,
      summary: redactSecrets(
        timedOut
          ? `Claude Code did not finish within ${timeoutSeconds}s and was terminated.`
          : `Claude Code process failed: ${err.message}`,
      ),
      costUsd: undefined,
      wallClockSeconds,
      rawStdout: redactSecrets(String(err.stdout || "")),
      rawStderr: redactSecrets(String(err.stderr || "")),
    };
  }

  const wallClockSeconds = (Date.now() - startedAt) / 1000;
  const stdout = String(raw.stdout || "");
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // Fall through with parsed = null; report the raw (redacted) text.
  }

  if (!parsed) {
    return {
      id: "claude-code",
      ok: false,
      timedOut: false,
      summary: "Claude Code did not return parseable JSON output.",
      costUsd: undefined,
      wallClockSeconds,
      rawStdout: redactSecrets(stdout),
      rawStderr: redactSecrets(String(raw.stderr || "")),
    };
  }

  return {
    id: "claude-code",
    ok: parsed.is_error === false,
    timedOut: false,
    summary: redactSecrets(String(parsed.result || "")),
    costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined,
    wallClockSeconds,
    sessionId: parsed.session_id,
    numTurns: parsed.num_turns,
    rawStdout: redactSecrets(stdout),
    rawStderr: redactSecrets(String(raw.stderr || "")),
  };
}
