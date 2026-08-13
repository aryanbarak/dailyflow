import { tasksService } from "@/features/tasks/tasksService";
import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
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
  async execute(input: Record<string, unknown>) {
    const validation = validateTasksUpdateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "tasks.update input failed validation.");
    const userId = String(input.userId).trim();
    const taskId = String(input.taskId).trim();
    try {
      const before = await tasksService.getTaskForUser(userId, taskId);
      const updates = {
        ...(typeof input.title === "string" ? { title: input.title } : {}),
        ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
        ...(input.dueDate !== undefined ? { dueDate: typeof input.dueDate === "string" ? input.dueDate : null } : {}),
      };
      const updated = await tasksService.updateTask(userId, taskId, updates);
      const readback = await tasksService.getTaskForUser(userId, taskId);
      const verified = readback.id === updated.id && readback.updatedAt === updated.updatedAt;
      if (!verified) return failure("verification_failed", "VERIFICATION_FAILED", "Updated task could not be verified.", taskId);
      return {
        status: "success",
        success: true,
        data: Object.freeze({ taskId, title: updated.title, dueDate: updated.dueDate ?? null, verified: true }),
        auditMetadata: { taskId, verified: true, resultShape: "object", redacted: true },
        compensation: {
          operation: "restore_task_fields",
          taskId,
          previous: { title: before.title, notes: before.notes, dueDate: before.dueDate ?? null, completed: before.completed },
        },
      };
    } catch {
      return failure("failed", "TASK_UPDATE_FAILED", "Unable to update task.", taskId);
    }
  },
};
