// EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.

import type {
  ExecutionError,
  GitHubFileUpdateClient,
  GitHubFileUpdateInput,
  GitHubFileUpdateResult,
} from "@/features/agent/executionTypes";

interface GitHubFileUpdateClientOptions {
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
  base.pathname = `${base.pathname.replace(/\/$/, "")}/github/files/update`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function createGitHubFileUpdateClient(
  options: GitHubFileUpdateClientOptions,
): GitHubFileUpdateClient {
  const endpoint = updateEndpoint(options.workerBaseUrl);
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async updateFile(input: GitHubFileUpdateInput): Promise<GitHubFileUpdateResult> {
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
            proposalId: input.proposalId,
            repo: input.repo,
            path: input.path,
            proposedContent: input.proposedContent,
            ...(input.commitMessage !== undefined ? { commitMessage: input.commitMessage } : {}),
          }),
        });
      } catch {
        throw safeExecutionError("GITHUB_INTEGRATION_UNAVAILABLE", "GitHub file update is unavailable.");
      }

      if (!response.ok) {
        let code = "GITHUB_FILE_UPDATE_FAILED";
        try {
          const errorBody = await response.json() as { error?: { code?: unknown } };
          const providerCode = safeString(errorBody.error?.code, 64);
          if (providerCode) code = providerCode;
        } catch {
          // Fall back to the generic code below.
        }
        throw safeExecutionError(code, "GitHub file could not be updated safely.");
      }

      const body = await response.json() as Partial<GitHubFileUpdateResult>;
      const repo = safeString(body.repo, 200);
      const path = safeString(body.path, 400);
      const branch = safeString(body.branch, 250);
      const commitSha = safeString(body.commitSha, 64);
      const blobSha = safeString(body.blobSha, 64);
      const commitUrl = safeString(body.commitUrl, 500);
      if (!repo || !path || !branch || !commitSha || !blobSha || !commitUrl || !isGithubDotComUrl(commitUrl)) {
        throw safeExecutionError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid file update response.");
      }
      return { repo, path, branch, commitSha, blobSha, commitUrl };
    },
  });
}
