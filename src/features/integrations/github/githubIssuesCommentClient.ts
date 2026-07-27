import type {
  ExecutionError,
  GitHubIssueCommentClient,
  GitHubIssueCommentInput,
  GitHubIssueCommentResult,
} from "@/features/agent/executionTypes";

interface GitHubIssuesCommentClientOptions {
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

function commentEndpoint(workerBaseUrl: string) {
  const base = new URL(workerBaseUrl);
  if (base.username || base.password || (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")) {
    throw safeExecutionError("GITHUB_CONFIGURATION_INVALID", "GitHub integration endpoint is invalid.");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/github/issues/comment`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function createGitHubIssuesCommentClient(
  options: GitHubIssuesCommentClientOptions,
): GitHubIssueCommentClient {
  const endpoint = commentEndpoint(options.workerBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async createComment(input: GitHubIssueCommentInput): Promise<GitHubIssueCommentResult> {
      const accessToken = await options.getAccessToken();
      if (!accessToken) throw safeExecutionError("AUTH_REQUIRED", "Authentication is required.");

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repo: input.repo,
            issue_number: input.issueNumber,
            body: input.body,
          }),
        });
      } catch {
        throw safeExecutionError("GITHUB_INTEGRATION_UNAVAILABLE", "GitHub comment creation is unavailable.");
      }

      if (!response.ok) {
        let code = "GITHUB_ISSUE_COMMENT_FAILED";
        try {
          const errorBody = await response.json() as { error?: { code?: unknown } };
          const providerCode = safeString(errorBody.error?.code, 64);
          if (providerCode) code = providerCode;
        } catch {
          // Fall back to the generic code below.
        }
        throw safeExecutionError(code, "GitHub comment could not be created safely.");
      }

      const body = await response.json() as { commentId?: unknown; url?: unknown };
      const commentId = typeof body.commentId === "number" && Number.isSafeInteger(body.commentId) && body.commentId > 0
        ? body.commentId
        : undefined;
      const url = safeString(body.url, 500);
      if (!commentId || !url || !isGithubDotComUrl(url)) {
        throw safeExecutionError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid comment response.");
      }
      return { commentId, url };
    },
  });
}
