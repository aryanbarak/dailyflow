// EPIC-08 Slice 1 -- see docs/roadmap/epic-08-write-code-design-v1.md.
import type {
  ExecutionError,
  GitHubFileContentClient,
  GitHubFileContentInput,
  GitHubFileContentResult,
} from "@/features/agent/executionTypes";

interface GitHubFileContentClientOptions {
  workerBaseUrl: string;
  getAccessToken(): Promise<string | undefined>;
  fetcher?: typeof fetch;
}

const MAX_CONTENT_LENGTH = 128 * 1024;

function safeExecutionError(code: string, message: string): ExecutionError {
  return { code, message, retryable: false };
}

function safeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function fileEndpoint(workerBaseUrl: string, input: GitHubFileContentInput) {
  const base = new URL(workerBaseUrl);
  if (base.username || base.password || (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1")) {
    throw safeExecutionError("GITHUB_CONFIGURATION_INVALID", "GitHub integration endpoint is invalid.");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/github/files/read`;
  base.search = "";
  base.hash = "";
  base.searchParams.set("repo", input.repo);
  base.searchParams.set("path", input.path);
  return base.toString();
}

function parseFile(body: unknown): GitHubFileContentResult["file"] {
  if (!body || typeof body !== "object") return null;
  const item = body as Record<string, unknown>;
  const repo = safeString(item.repo, 200);
  const path = safeString(item.path, 400);
  const branch = safeString(item.branch, 250);
  const blobSha = safeString(item.blobSha, 64);
  const commitSha = safeString(item.commitSha, 64);
  const content = safeString(item.content, MAX_CONTENT_LENGTH);
  const size = typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0 ? item.size : undefined;
  if (!repo || !path || !branch || !blobSha || !commitSha || size === undefined) return null;
  return { repo, path, branch, blobSha, commitSha, content, size };
}

export function createGitHubFileContentClient(
  options: GitHubFileContentClientOptions,
): GitHubFileContentClient {
  const fetcher = options.fetcher ?? fetch;

  return Object.freeze({
    async readFile(input: GitHubFileContentInput): Promise<GitHubFileContentResult> {
      const accessToken = await options.getAccessToken();
      if (!accessToken) throw safeExecutionError("AUTH_REQUIRED", "Authentication is required.");

      let endpoint: string;
      try {
        endpoint = fileEndpoint(options.workerBaseUrl, input);
      } catch {
        throw safeExecutionError("GITHUB_CONFIGURATION_INVALID", "GitHub integration endpoint is invalid.");
      }

      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        throw safeExecutionError("GITHUB_INTEGRATION_UNAVAILABLE", "GitHub file access is unavailable.");
      }

      if (response.status === 409) {
        return { connectionStatus: "not_connected", file: null };
      }
      if (!response.ok) {
        throw safeExecutionError("GITHUB_FILE_READ_FAILED", "The file could not be read safely.");
      }
      const body = await response.json() as Record<string, unknown>;
      const file = parseFile(body);
      if (!file) {
        throw safeExecutionError("GITHUB_RESPONSE_INVALID", "GitHub returned an invalid file response.");
      }
      return { connectionStatus: "connected", file };
    },
  });
}
