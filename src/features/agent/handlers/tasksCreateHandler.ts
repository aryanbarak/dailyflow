import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
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
  // Chat V2 Slice 2A / BLOCKER A CORRECTION: routes exclusively through the
  // Worker's server-owned execution lifecycle
  // (agent/worker/agent-tool-execution.ts) -- browser-authored execution
  // status is not authoritative, so this handler no longer has any direct
  // Supabase write path of its own to fall back to. When no
  // agentToolExecutionClient is present in context, that is a bounded
  // failure, not a silent alternate write: an older caller or an
  // unconfigured test harness must be treated the same as "the Worker is
  // unreachable," never as "fall back to writing from the browser." Ordinary
  // (non-Agent) Tasks UI still uses tasksService directly -- this change
  // only removes tasksService as a fallback INSIDE this Agent handler.
  async execute(input: Record<string, unknown>, context: ExecutionContext = {}) {
    const validation = validateTasksCreateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "tasks.create input failed validation.");
    if (!context.agentToolExecutionClient) {
      return failure("failed", "AGENT_EXECUTION_CLIENT_UNAVAILABLE", "Server-owned execution is unavailable.");
    }
    const title = String(input.title).trim();
    const notes = typeof input.notes === "string" ? input.notes : undefined;
    const dueDate = typeof input.dueDate === "string" ? input.dueDate : null;

    try {
      const outcome = await context.agentToolExecutionClient.requestAndExecute({
        toolId: "tasks.create",
        arguments: { title, notes, dueDate },
        requestId: crypto.randomUUID(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (outcome.status !== "succeeded" || !outcome.targetId) {
        return failure("failed", outcome.errorCode ?? "TASK_CREATE_FAILED", outcome.reply || "Unable to create task.");
      }
      return {
        status: "success",
        success: true,
        data: Object.freeze({ taskId: outcome.targetId, title, dueDate, verified: true }),
        auditMetadata: { taskId: outcome.targetId, verified: true, resultShape: "object", redacted: true },
        compensation: { taskId: outcome.targetId, previousCompleted: false, previousCompletedAt: null },
      };
    } catch (caught) {
      const error = caught as Partial<ExecutionError>;
      return failure("failed", typeof error.code === "string" ? error.code : "TASK_CREATE_FAILED", typeof error.message === "string" ? error.message : "Unable to create task.");
    }
  },
};
