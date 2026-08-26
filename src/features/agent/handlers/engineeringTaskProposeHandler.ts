// ENG-04 -- see docs/architecture/notes/eng-04-companion-chat-approval-wiring-v1.md.
// Mirrors githubFilesUpdateHandler.ts's shape. This handler's own execution
// is intentionally lightweight -- it only submits the task (POST
// /engineering-tasks); it does NOT run Claude Code, does NOT wait for the
// result, and its "success" means "queued," never "done." The real result
// arrives later as a separate chat message once the companion reports back
// (see ChatPage.tsx's status-polling addition).

import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionInputValidationResult,
  EngineeringTaskProposeResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export type EngineeringTaskProposeHandlerOutput = EngineeringTaskProposeResult;

const MAX_REPO_LENGTH = 200;
const MAX_INSTRUCTION_LENGTH = 4000;
const MAX_TASK_CLASS_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

function validateEngineeringTaskProposeInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) {
    return { valid: false, errors: ["Input must be an object."] };
  }

  const errors: string[] = [];
  const allowedFields = new Set(["repo", "instruction", "taskClass"]);
  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      errors.push(`${key} is not allowed for engineering.task.propose.`);
    }
  }

  if (typeof input.repo !== "string" || !input.repo.trim() || input.repo.length > MAX_REPO_LENGTH) {
    errors.push("repo is required.");
  }
  if (typeof input.instruction !== "string" || !input.instruction.trim() || input.instruction.length > MAX_INSTRUCTION_LENGTH) {
    errors.push("instruction is required.");
  }
  if (typeof input.taskClass !== "string" || !input.taskClass.trim() || input.taskClass.length > MAX_TASK_CLASS_LENGTH) {
    errors.push("taskClass is required.");
  }

  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<EngineeringTaskProposeHandlerOutput>["status"],
  code: string,
  message: string,
): AgentWriteToolExecutionResult<EngineeringTaskProposeHandlerOutput> {
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

export const engineeringTaskProposeHandler: AgentWriteToolHandler<EngineeringTaskProposeHandlerOutput> = {
  toolId: "engineering.task.propose",
  mode: "write",
  timeoutMs: 15_000,
  readOnly: false,
  externalEffect: true,
  reversible: false,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateEngineeringTaskProposeInput(input);
  },
  async execute(input: Record<string, unknown>, context: ExecutionContext) {
    const validation = validateEngineeringTaskProposeInput(input);
    if (!validation.valid) {
      return failure("invalid_input", "INVALID_INPUT", "engineering.task.propose input failed validation.");
    }
    if (!context.engineeringTaskClient) {
      return failure("failed", "ENGINEERING_TASKS_NOT_CONFIGURED", "Engineering task submission is not configured.");
    }

    try {
      const result = await context.engineeringTaskClient.propose({
        repo: input.repo as string,
        instruction: input.instruction as string,
        taskClass: input.taskClass as string,
      });

      if (!result.id || !result.status) {
        return failure("verification_failed", "VERIFICATION_FAILED", "Engineering task submission could not be verified.");
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
        typeof error.code === "string" ? error.code : "ENGINEERING_TASK_SUBMIT_FAILED",
        typeof error.message === "string" ? error.message : "Unable to submit engineering task.",
      );
    }
  },
};
