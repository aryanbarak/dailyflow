import type {
  ExecutionError,
  GitHubEpicSummary,
  GitHubEpicsClient,
  GitHubEpicsResult,
} from "@/features/agent/executionTypes";

interface GitHubEpicsClientOptions {
  workerBaseUrl: string;
  getAccessToken(): Promise<string | undefined>;
  fetcher?: typeof fetch;
}

function safeExecutionError(code: string, message: string): ExecutionError {
  return { code, message, retryable: false };
}

function safeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isGitHubIssueUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function epic(value: unknown): GitHubEpicSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const repo = safeString(item.repo, 200);
  const number = typeof item.number === "number" && Number.isSafeInteger(item.number) && item.number > 0
    ? item.number
    : undefined;
  const title = safeString(item.title, 200);
  const epicLabel = safeString(item.epic, 100);
  const status = safeString(item.status, 100);
  const url = safeString(item.url, 500);
  if (!repo || !number || !title || !epicLabel || !url || !isGitHubIssueUrl(url)) return undefined;
  return { repo, number, title, epic: epicLabel, status, url };
}

function epicsEndpoint(workerBaseUrl: string) {
  const base = new URL(workerBaseUrl);
  if (base.username || base.password || (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")) {
    throw safeExecutionError("GITHUB_CONFIGURATION_INVALID", "GitHub integration endpoint is invalid.");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/github/epics`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function createGitHubEpicsClient(
  options: GitHubEpicsClientOptions,
): GitHubEpicsClient {
  const endpoint = epicsEndpoint(options.workerBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async listEpics(): Promise<GitHubEpicsResult> {
      const accessToken = await options.getAccessToken();
      if (!accessToken) throw safeExecutionError("AUTH_REQUIRED", "Authentication is required.");

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        throw safeExecutionError("GITHUB_INTEGRATION_UNAVAILABLE", "GitHub epic access is unavailable.");
      }

      if (response.status === 409) {
        return { connectionStatus: "not_connected", epics: [] };
      }
      if (!response.ok) {
        throw safeExecutionError("GITHUB_EPICS_FAILED", "GitHub epics could not be loaded safely.");
      }
      const body = await response.json() as { epics?: unknown };
      if (!Array.isArray(body.epics)) {
        throw safeExecutionError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid epics response.");
      }
      return {
        connectionStatus: "connected",
        epics: body.epics
          .slice(0, 20)
          .map(epic)
          .filter((item): item is GitHubEpicSummary => Boolean(item)),
      };
    },
  });
}
