import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionInputValidationResult,
  GitHubIssueUpdateResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export type GitHubIssuesUpdateHandlerOutput = GitHubIssueUpdateResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function validateGithubIssuesUpdateInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) {
    return { valid: false, errors: ["Input must be an object."] };
  }

  const errors: string[] = [];
  const allowedFields = new Set(["repo", "issueNumber", "title", "body", "labels"]);

  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      errors.push(`${key} is not allowed for github.issues.update.`);
    }
  }

  if (typeof input.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(input.repo)) {
    errors.push("repo is required and must be an owner/name identifier.");
  }
  if (typeof input.issueNumber !== "number" || !Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0) {
    errors.push("issueNumber is required and must be a positive integer.");
  }
  if (input.title !== undefined && typeof input.title !== "string") {
    errors.push("title must be a string when present.");
  }
  if (input.body !== undefined && typeof input.body !== "string") {
    errors.push("body must be a string when present.");
  }
  if (input.labels !== undefined && !isStringArray(input.labels)) {
    errors.push("labels must be a non-empty array of non-empty strings when present.");
  }
  if (input.title === undefined && input.body === undefined && input.labels === undefined) {
    errors.push("At least one of title, body, or labels is required.");
  }

  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<GitHubIssuesUpdateHandlerOutput>["status"],
  code: string,
  message: string,
): AgentWriteToolExecutionResult<GitHubIssuesUpdateHandlerOutput> {
  return {
    status,
    success: false,
    error: executionError(code, message),
    auditMetadata: {
      verified: false,
      resultShape: "object",
      redacted: true,
    },
  };
}

export const githubIssuesUpdateHandler: AgentWriteToolHandler<GitHubIssuesUpdateHandlerOutput> = {
  toolId: "github.issues.update",
  mode: "write",
  timeoutMs: 10_000,
  readOnly: false,
  externalEffect: true,
  reversible: false,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateGithubIssuesUpdateInput(input);
  },
  async execute(input: Record<string, unknown>, context: ExecutionContext) {
    const validation = validateGithubIssuesUpdateInput(input);
    if (!validation.valid) {
      return failure("invalid_input", "INVALID_INPUT", "github.issues.update input failed validation.");
    }
    if (!context.githubIssueUpdateClient) {
      return failure("failed", "GITHUB_NOT_CONNECTED", "GitHub is not connected.");
    }

    try {
      const result = await context.githubIssueUpdateClient.updateIssue({
        repo: input.repo as string,
        issueNumber: input.issueNumber as number,
        ...(input.title !== undefined ? { title: input.title as string } : {}),
        ...(input.body !== undefined ? { body: input.body as string } : {}),
        ...(input.labels !== undefined ? { labels: input.labels as string[] } : {}),
      });

      if (!result.issueNumber || !result.url) {
        return failure("verification_failed", "VERIFICATION_FAILED", "Issue update could not be verified.");
      }

      return {
        status: "success",
        success: true,
        data: result,
        auditMetadata: {
          verified: true,
          resultShape: "object",
          redacted: true,
        },
      };
    } catch (caught) {
      const error = caught as Partial<ExecutionError>;
      return failure(
        "failed",
        typeof error.code === "string" ? error.code : "GITHUB_ISSUE_UPDATE_FAILED",
        typeof error.message === "string" ? error.message : "Unable to update GitHub issue.",
      );
    }
  },
};
