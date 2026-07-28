// EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
// Reuses the exact same repo/path/content validators Slice 1/2 already built
// and tested (codeProposalValidator.ts) -- no new validation rules here.

import { validateCodeFileContent, validateRepositoryIdentifier, validateRepositoryRelativePath } from "../codeChange/codeProposalValidator";
import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionInputValidationResult,
  GitHubFileUpdateResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export type GitHubFilesUpdateHandlerOutput = GitHubFileUpdateResult;

const MAX_PROPOSAL_ID_LENGTH = 200;
const MAX_COMMIT_MESSAGE_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

// EPIC-08 Slice 3 -- see docs/adr/ADR-0005-code-write-mutation-boundary.md.
// Deliberately does not accept baseBlobSha/baseCommitSha/proposedContentDigest/
// riskLevel/expiresAt -- those are never trusted request fields, here or at
// the Worker (ADR-0005 Decision 7).
function validateGithubFilesUpdateInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) {
    return { valid: false, errors: ["Input must be an object."] };
  }

  const errors: string[] = [];
  const allowedFields = new Set(["proposalId", "repo", "path", "proposedContent", "commitMessage"]);
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      errors.push(`${key} is not allowed for github.files.update.`);
    }
  }

  if (typeof input.proposalId !== "string" || !input.proposalId.trim() || input.proposalId.length > MAX_PROPOSAL_ID_LENGTH) {
    errors.push("proposalId is required.");
  }
  errors.push(...validateRepositoryIdentifier(input.repo as string).errors);
  errors.push(...validateRepositoryRelativePath(input.path as string).errors);
  if (typeof input.proposedContent !== "string") {
    errors.push("proposedContent is required.");
  } else {
    errors.push(...validateCodeFileContent({ content: input.proposedContent, label: "proposed" }).errors);
  }
  if (
    input.commitMessage !== undefined &&
    (typeof input.commitMessage !== "string" || input.commitMessage.length > MAX_COMMIT_MESSAGE_LENGTH)
  ) {
    errors.push(`commitMessage must be a string of at most ${MAX_COMMIT_MESSAGE_LENGTH} characters when present.`);
  }

  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<GitHubFilesUpdateHandlerOutput>["status"],
  code: string,
  message: string,
): AgentWriteToolExecutionResult<GitHubFilesUpdateHandlerOutput> {
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

export const githubFilesUpdateHandler: AgentWriteToolHandler<GitHubFilesUpdateHandlerOutput> = {
  toolId: "github.files.update",
  mode: "write",
  timeoutMs: 15_000,
  readOnly: false,
  externalEffect: true,
  reversible: false,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateGithubFilesUpdateInput(input);
  },
  async execute(input: Record<string, unknown>, context: ExecutionContext) {
    const validation = validateGithubFilesUpdateInput(input);
    if (!validation.valid) {
      return failure("invalid_input", "INVALID_INPUT", "github.files.update input failed validation.");
    }
    if (!context.githubFileUpdateClient) {
      return failure("failed", "GITHUB_NOT_CONNECTED", "GitHub is not connected.");
    }

    try {
      const result = await context.githubFileUpdateClient.updateFile({
        proposalId: input.proposalId as string,
        repo: input.repo as string,
        path: input.path as string,
        proposedContent: input.proposedContent as string,
        ...(input.commitMessage !== undefined ? { commitMessage: input.commitMessage as string } : {}),
      });

      if (!result.commitSha || !result.blobSha || !result.branch || !result.commitUrl) {
        return failure("verification_failed", "VERIFICATION_FAILED", "File update could not be verified.");
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
        typeof error.code === "string" ? error.code : "GITHUB_FILE_UPDATE_FAILED",
        typeof error.message === "string" ? error.message : "Unable to update GitHub file.",
      );
    }
  },
};
