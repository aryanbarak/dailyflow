import type {
  ExecutionError,
  GitHubIssueUpdateClient,
  GitHubIssueUpdateInput,
  GitHubIssueUpdateResult,
} from "@/features/agent/executionTypes";

interface GitHubIssuesUpdateClientOptions {
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

function isGithubDotComUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function updateEndpoint(workerBaseUrl: string) {
  const base = new URL(workerBaseUrl);
  if (base.username || base.password || (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")) {
    throw safeExecutionError("GITHUB_CONFIGURATION_INVALID", "GitHub integration endpoint is invalid.");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/github/issues/update`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function createGitHubIssuesUpdateClient(
  options: GitHubIssuesUpdateClientOptions,
): GitHubIssueUpdateClient {
  const endpoint = updateEndpoint(options.workerBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async updateIssue(input: GitHubIssueUpdateInput): Promise<GitHubIssueUpdateResult> {
      const accessToken = await options.getAccessToken();
      if (!accessToken) throw safeExecutionError("AUTH_REQUIRED", "Authentication is required.");

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repo: input.repo,
            issue_number: input.issueNumber,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.body !== undefined ? { body: input.body } : {}),
            ...(input.labels !== undefined ? { labels: input.labels } : {}),
          }),
        });
      } catch {
        throw safeExecutionError("GITHUB_INTEGRATION_UNAVAILABLE", "GitHub issue update is unavailable.");
      }

      if (!response.ok) {
        let code = "GITHUB_ISSUE_UPDATE_FAILED";
        try {
          const errorBody = await response.json() as { error?: { code?: unknown } };
          const providerCode = safeString(errorBody.error?.code, 64);
          if (providerCode) code = providerCode;
        } catch {
          // Fall back to the generic code below.
        }
        throw safeExecutionError(code, "GitHub issue could not be updated safely.");
      }

      const body = await response.json() as { issueNumber?: unknown; url?: unknown };
      const issueNumber = typeof body.issueNumber === "number" && Number.isSafeInteger(body.issueNumber) && body.issueNumber > 0
        ? body.issueNumber
        : undefined;
      const url = safeString(body.url, 500);
      if (!issueNumber || !url || !isGithubDotComUrl(url)) {
        throw safeExecutionError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid issue response.");
      }
      return { issueNumber, url };
    },
  });
}
