import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionInputValidationResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export interface TasksUpdateHandlerOutput {
  taskId: string;
  title: string;
  dueDate: string | null;
  verified: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

function validateTasksUpdateInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) return { valid: false, errors: ["Input must be an object."] };
  const allowed = new Set(["userId", "taskId", "title", "notes", "dueDate"]);
  const errors = Object.keys(input)
    .filter((key) => !allowed.has(key))
    .map((key) => `${key} is not allowed for tasks.update.`);
  if (typeof input.userId !== "string" || !input.userId.trim()) errors.push("userId is required.");
  if (typeof input.taskId !== "string" || !input.taskId.trim()) errors.push("taskId is required.");
  if (input.title === undefined && input.notes === undefined && input.dueDate === undefined) {
    errors.push("At least one update field is required.");
  }
  if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim())) errors.push("title must be a non-empty string.");
  if (input.notes !== undefined && typeof input.notes !== "string") errors.push("notes must be a string.");
  if (input.dueDate !== undefined && input.dueDate !== null && typeof input.dueDate !== "string") errors.push("dueDate must be a string or null.");
  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<TasksUpdateHandlerOutput>["status"],
  code: string,
  message: string,
  taskId?: string,
): AgentWriteToolExecutionResult<TasksUpdateHandlerOutput> {
  return {
    status,
    success: false,
    error: executionError(code, message),
    auditMetadata: { taskId, verified: false, resultShape: "object", redacted: true },
  };
}

export const tasksUpdateHandler: AgentWriteToolHandler<TasksUpdateHandlerOutput> = {
  toolId: "tasks.update",
  mode: "write",
  timeoutMs: 3000,
  readOnly: false,
  externalEffect: true,
  reversible: true,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateTasksUpdateInput(input);
  },
  // Chat V2 Slice 2A / BLOCKER A CORRECTION: see tasksCreateHandler.ts's own
  // comment on this same change -- no direct-write fallback remains.
  async execute(input: Record<string, unknown>, context: ExecutionContext = {}) {
    const validation = validateTasksUpdateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "tasks.update input failed validation.");
    const taskId = String(input.taskId).trim();
    if (!context.agentToolExecutionClient) {
      return failure("failed", "AGENT_EXECUTION_CLIENT_UNAVAILABLE", "Server-owned execution is unavailable.", taskId);
    }
    const updates = {
      ...(typeof input.title === "string" ? { title: input.title } : {}),
      ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
      ...(input.dueDate !== undefined ? { dueDate: typeof input.dueDate === "string" ? input.dueDate : null } : {}),
    };

    try {
      const outcome = await context.agentToolExecutionClient.requestAndExecute({
        toolId: "tasks.update",
        targetId: taskId,
        arguments: updates,
        requestId: crypto.randomUUID(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (outcome.status !== "succeeded") {
        return failure("failed", outcome.errorCode ?? "TASK_UPDATE_FAILED", outcome.reply || "Unable to update task.", taskId);
      }
      return {
        status: "success",
        success: true,
        data: Object.freeze({ taskId, title: (updates.title as string | undefined) ?? "", dueDate: (updates as { dueDate?: string | null }).dueDate ?? null, verified: true }),
        auditMetadata: { taskId, verified: true, resultShape: "object", redacted: true },
      };
    } catch (caught) {
      const error = caught as Partial<ExecutionError>;
      return failure("failed", typeof error.code === "string" ? error.code : "TASK_UPDATE_FAILED", typeof error.message === "string" ? error.message : "Unable to update task.", taskId);
    }
  },
};
