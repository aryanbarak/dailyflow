import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionInputValidationResult,
  GitHubIssueCommentResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export type GitHubIssuesCommentHandlerOutput = GitHubIssueCommentResult;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

function validateGithubIssuesCommentInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) {
    return { valid: false, errors: ["Input must be an object."] };
  }

  const errors: string[] = [];
  const allowedFields = new Set(["repo", "issueNumber", "body"]);

  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      errors.push(`${key} is not allowed for github.issues.comment.`);
    }
  }

  if (typeof input.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(input.repo)) {
    errors.push("repo is required and must be an owner/name identifier.");
  }
  if (typeof input.issueNumber !== "number" || !Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0) {
    errors.push("issueNumber is required and must be a positive integer.");
  }
  if (typeof input.body !== "string" || input.body.trim().length === 0) {
    errors.push("body is required.");
  }

  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<GitHubIssuesCommentHandlerOutput>["status"],
  code: string,
  message: string,
): AgentWriteToolExecutionResult<GitHubIssuesCommentHandlerOutput> {
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

export const githubIssuesCommentHandler: AgentWriteToolHandler<GitHubIssuesCommentHandlerOutput> = {
  toolId: "github.issues.comment",
  mode: "write",
  timeoutMs: 10_000,
  readOnly: false,
  externalEffect: true,
  reversible: false,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateGithubIssuesCommentInput(input);
  },
  async execute(input: Record<string, unknown>, context: ExecutionContext) {
    const validation = validateGithubIssuesCommentInput(input);
    if (!validation.valid) {
      return failure("invalid_input", "INVALID_INPUT", "github.issues.comment input failed validation.");
    }
    if (!context.githubIssueCommentClient) {
      return failure("failed", "GITHUB_NOT_CONNECTED", "GitHub is not connected.");
    }

    try {
      const result = await context.githubIssueCommentClient.createComment({
        repo: input.repo as string,
        issueNumber: input.issueNumber as number,
        body: input.body as string,
      });

      if (!result.commentId || !result.url) {
        return failure("verification_failed", "VERIFICATION_FAILED", "Comment creation could not be verified.");
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
        typeof error.code === "string" ? error.code : "GITHUB_ISSUE_COMMENT_FAILED",
        typeof error.message === "string" ? error.message : "Unable to create GitHub comment.",
      );
    }
  },
};
