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
  // Supabase write path of its own to fall back to. Ordinary (non-Agent)
  // Tasks UI still uses tasksService directly -- this change only removes
  // tasksService as a fallback INSIDE this Agent handler.
  //
  // BLOCKER 1 CORRECTION: the request that durably creates the
  // approval_pending row now happens BEFORE the user approves (see
  // writeRuntime.ts's requestWriteExecution and ChatPage.tsx's own wiring),
  // never inside this execute() call. By the time this runs,
  // context.pendingAgentExecutionId already names that exact row --
  // approveExecution() below sends nothing but that id, never args again.
  // Missing agentToolExecutionClient OR pendingAgentExecutionId is a bounded
  // failure (an older caller, an unconfigured test harness, or a pre-request
  // that never completed) -- never a fallback to requesting-and-approving
  // in one call here, which would reintroduce exactly what Blocker 1 forbids.
  async execute(input: Record<string, unknown>, context: ExecutionContext = {}) {
    const validation = validateTasksCreateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "tasks.create input failed validation.");
    if (!context.agentToolExecutionClient || !context.pendingAgentExecutionId) {
      return failure("failed", "AGENT_EXECUTION_NOT_REQUESTED", "Server-owned execution was not requested before approval.");
    }
    const title = String(input.title).trim();
    const dueDate = typeof input.dueDate === "string" ? input.dueDate : null;

    try {
      const outcome = await context.agentToolExecutionClient.approveExecution(context.pendingAgentExecutionId);
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
