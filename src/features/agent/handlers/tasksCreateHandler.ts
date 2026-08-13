import { tasksService } from "@/features/tasks/tasksService";
import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionError,
  ExecutionInputValidationResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export interface TasksCreateHandlerOutput {
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

function validateTasksCreateInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) return { valid: false, errors: ["Input must be an object."] };
  const allowed = new Set(["userId", "title", "notes", "dueDate"]);
  const errors = Object.keys(input)
    .filter((key) => !allowed.has(key))
    .map((key) => `${key} is not allowed for tasks.create.`);
  if (typeof input.userId !== "string" || !input.userId.trim()) errors.push("userId is required.");
  if (typeof input.title !== "string" || !input.title.trim()) errors.push("title is required.");
  if (input.notes !== undefined && typeof input.notes !== "string") errors.push("notes must be a string.");
  if (input.dueDate !== undefined && input.dueDate !== null && typeof input.dueDate !== "string") errors.push("dueDate must be a string or null.");
  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<TasksCreateHandlerOutput>["status"],
  code: string,
  message: string,
  taskId?: string,
): AgentWriteToolExecutionResult<TasksCreateHandlerOutput> {
  return {
    status,
    success: false,
    error: executionError(code, message),
    auditMetadata: { taskId, verified: false, resultShape: "object", redacted: true },
  };
}

export const tasksCreateHandler: AgentWriteToolHandler<TasksCreateHandlerOutput> = {
  toolId: "tasks.create",
  mode: "write",
  timeoutMs: 3000,
  readOnly: false,
  externalEffect: true,
  reversible: true,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateTasksCreateInput(input);
  },
  async execute(input: Record<string, unknown>) {
    const validation = validateTasksCreateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "tasks.create input failed validation.");
    const userId = String(input.userId).trim();
    const title = String(input.title).trim();
    const notes = typeof input.notes === "string" ? input.notes : undefined;
    const dueDate = typeof input.dueDate === "string" ? input.dueDate : null;
    try {
      const created = await tasksService.createTask(userId, { title, notes, dueDate });
      const readback = await tasksService.getTaskForUser(userId, created.id);
      const verified = readback.id === created.id && readback.title === created.title && readback.completed === false;
      if (!verified) return failure("verification_failed", "VERIFICATION_FAILED", "Created task could not be verified.", created.id);
      return {
        status: "success",
        success: true,
        data: Object.freeze({ taskId: created.id, title: created.title, dueDate: created.dueDate ?? null, verified: true }),
        auditMetadata: { taskId: created.id, verified: true, resultShape: "object", redacted: true },
        compensation: { operation: "delete_task", taskId: created.id },
      };
    } catch {
      return failure("failed", "TASK_CREATE_FAILED", "Unable to create task.");
    }
  },
};
