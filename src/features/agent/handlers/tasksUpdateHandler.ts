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
  //
  // BLOCKER 1 CORRECTION: the request that durably creates the row now
  // happens BEFORE approval; context.pendingAgentExecutionId already names
  // it here -- approveExecution() sends nothing else.
  //
  // BLOCKER 3 CORRECTION: this used to build `data` (and claim
  // `verified: true`) from the LOCALLY ECHOED `updates` object -- the
  // fields the request ASKED to change, never proof they were actually
  // applied (a real, pre-existing bug in the Worker's own PATCH body meant
  // title/notes were silently dropped there; see flow-write-policy.ts's own
  // fix). Now built from the Worker's own authoritative response
  // (outcome.title/dueDate), which reflects the row's real, just-persisted
  // state.
  async execute(input: Record<string, unknown>, context: ExecutionContext = {}) {
    const validation = validateTasksUpdateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "tasks.update input failed validation.");
    const taskId = String(input.taskId).trim();
    if (!context.agentToolExecutionClient || !context.pendingAgentExecutionId) {
      return failure("failed", "AGENT_EXECUTION_NOT_REQUESTED", "Server-owned execution was not requested before approval.", taskId);
    }

    try {
      const outcome = await context.agentToolExecutionClient.approveExecution(context.pendingAgentExecutionId);
      if (outcome.status !== "succeeded" || !outcome.title) {
        return failure("failed", outcome.errorCode ?? "TASK_UPDATE_FAILED", outcome.reply || "Unable to update task.", taskId);
      }
      return {
        status: "success",
        success: true,
        data: Object.freeze({ taskId, title: outcome.title, dueDate: outcome.dueDate ?? null, verified: true }),
        auditMetadata: { taskId, verified: true, resultShape: "object", redacted: true },
      };
    } catch (caught) {
      const error = caught as Partial<ExecutionError>;
      return failure("failed", typeof error.code === "string" ? error.code : "TASK_UPDATE_FAILED", typeof error.message === "string" ? error.message : "Unable to update task.", taskId);
    }
  },
};
