import { tasksService, TaskServiceError } from "@/features/tasks/tasksService";
import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionInputValidationResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export interface TasksCompleteHandlerOutput {
  taskId: string;
  completed: true;
  completedAt: string;
  alreadyCompleted: boolean;
  verified: boolean;
}

type TasksCompleteInput = {
  userId: string;
  taskId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

function validateTasksCompleteInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) {
    return { valid: false, errors: ["Input must be an object."] };
  }

  const errors: string[] = [];
  const allowedFields = new Set(["userId", "taskId"]);

  for (const key of Object.keys(input)) {
    if (!allowedFields.has(key)) {
      errors.push(`${key} is not allowed for tasks.complete.`);
    }
  }

  if (typeof input.userId !== "string" || input.userId.trim().length === 0) {
    errors.push("userId is required.");
  }
  if (typeof input.taskId !== "string" || input.taskId.trim().length === 0) {
    errors.push("taskId is required.");
  }

  return { valid: errors.length === 0, errors };
}

function normalizeInput(input: Record<string, unknown>): TasksCompleteInput {
  return {
    userId: String(input.userId).trim(),
    taskId: String(input.taskId).trim(),
  };
}

function failure(
  status: AgentWriteToolExecutionResult<TasksCompleteHandlerOutput>["status"],
  code: string,
  message: string,
  taskId?: string,
): AgentWriteToolExecutionResult<TasksCompleteHandlerOutput> {
  return {
    status,
    success: false,
    error: executionError(code, message),
    auditMetadata: {
      taskId,
      alreadyCompleted: undefined,
      verified: false,
      resultShape: "object",
      redacted: true,
    },
  };
}

export const tasksCompleteHandler: AgentWriteToolHandler<TasksCompleteHandlerOutput> = {
  toolId: "tasks.complete",
  mode: "write",
  timeoutMs: 3000,
  readOnly: false,
  externalEffect: true,
  reversible: true,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateTasksCompleteInput(input);
  },
  // Chat V2 Slice 2A / BLOCKER A CORRECTION: only the actual completion
  // WRITE (below) ever routed through the Worker's server-owned execution
  // lifecycle -- the already-completed check just above it is a plain read
  // (ADR-0004: reads are non-consequential) and stays exactly as it was,
  // client or no client. The write itself now has NO direct-write fallback:
  // when no agentToolExecutionClient is present, that is a bounded failure,
  // never a silent tasksService.completeTask call. This handler is called
  // only after this tool's OWN, separate, pre-existing ExecutionIntent
  // ceremony (executionIntent.ts/approvalInteraction.ts's
  // shouldIssueExecutionIntentApproval) has already run and is untouched by
  // this slice -- see this slice's own report for why that stays intact.
  async execute(input: Record<string, unknown>, context: ExecutionContext = {}) {
    const validation = validateTasksCompleteInput(input);
    if (!validation.valid) {
      return failure("invalid_input", "INVALID_INPUT", "tasks.complete input failed validation.");
    }

    const { userId, taskId } = normalizeInput(input);

    try {
      const before = await tasksService.getTaskForUser(userId, taskId);

      if (before.completed === true) {
        const completedAt = before.completedAt ?? null;
        const verified =
          before.id === taskId &&
          typeof completedAt === "string" &&
          completedAt.length > 0;

        if (!verified) {
          return failure(
            "verification_failed",
            "VERIFICATION_FAILED",
            "Existing task completion could not be verified.",
            taskId,
          );
        }

        const data: TasksCompleteHandlerOutput = Object.freeze({
          taskId,
          completed: true,
          completedAt,
          alreadyCompleted: true,
          verified: true,
        });

        return {
          status: "success",
          success: true,
          data,
          auditMetadata: {
            taskId,
            alreadyCompleted: true,
            verified: true,
            resultShape: "object",
            redacted: true,
          },
          compensation: {
            taskId,
            previousCompleted: true,
            previousCompletedAt: completedAt,
          },
        };
      }

      // BLOCKER 1 CORRECTION: the request that durably creates the row now
      // happens BEFORE approval; context.pendingAgentExecutionId already
      // names it here -- approveExecution() sends nothing else.
      if (!context.agentToolExecutionClient || !context.pendingAgentExecutionId) {
        return {
          ...failure("failed", "AGENT_EXECUTION_NOT_REQUESTED", "Server-owned execution was not requested before approval.", taskId),
          compensation: { taskId, previousCompleted: before.completed, previousCompletedAt: before.completedAt ?? null },
        };
      }

      let outcome: Awaited<ReturnType<typeof context.agentToolExecutionClient.approveExecution>>;
      try {
        outcome = await context.agentToolExecutionClient.approveExecution(context.pendingAgentExecutionId);
      } catch (caught) {
        const error = caught as Partial<ExecutionError>;
        return {
          ...failure("failed", typeof error.code === "string" ? error.code : "TASK_COMPLETE_FAILED", typeof error.message === "string" ? error.message : "Unable to complete task.", taskId),
          compensation: { taskId, previousCompleted: before.completed, previousCompletedAt: before.completedAt ?? null },
        };
      }
      if (outcome.status !== "succeeded" || !outcome.completedAt) {
        return {
          ...failure(outcome.status === "succeeded" ? "verification_failed" : "failed", outcome.errorCode ?? "TASK_COMPLETE_FAILED", outcome.reply || "Unable to complete task.", taskId),
          compensation: { taskId, previousCompleted: before.completed, previousCompletedAt: before.completedAt ?? null },
        };
      }
      const completedAt = outcome.completedAt;

      const data: TasksCompleteHandlerOutput = Object.freeze({
        taskId,
        completed: true,
        completedAt,
        alreadyCompleted: false,
        verified: true,
      });

      return {
        status: "success",
        success: true,
        data,
        auditMetadata: {
          taskId,
          alreadyCompleted: false,
          verified: true,
          resultShape: "object",
          redacted: true,
        },
        compensation: {
          taskId,
          previousCompleted: before.completed,
          previousCompletedAt: before.completedAt ?? null,
        },
      };
    } catch (caught) {
      if (caught instanceof TaskServiceError) {
        return failure("failed", caught.code, caught.message, taskId);
      }

      return failure("failed", "TASK_COMPLETE_FAILED", "Unable to complete task.", taskId);
    }
  },
};
