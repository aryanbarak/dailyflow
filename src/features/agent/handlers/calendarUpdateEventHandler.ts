import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionInputValidationResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export interface CalendarUpdateEventHandlerOutput {
  eventId: string;
  title: string;
  dateTimeStart: string;
  verified: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function executionError(code: string, message: string, retryable = false): ExecutionError {
  return { code, message, retryable };
}

function validateCalendarUpdateInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) return { valid: false, errors: ["Input must be an object."] };
  const allowed = new Set(["userId", "eventId", "title", "dateTimeStart", "dateTimeEnd", "notes"]);
  const errors = Object.keys(input)
    .filter((key) => !allowed.has(key))
    .map((key) => `${key} is not allowed for calendar.update_event.`);
  if (typeof input.userId !== "string" || !input.userId.trim()) errors.push("userId is required.");
  if (typeof input.eventId !== "string" || !input.eventId.trim()) errors.push("eventId is required.");
  if (input.title === undefined && input.dateTimeStart === undefined && input.dateTimeEnd === undefined && input.notes === undefined) {
    errors.push("At least one update field is required.");
  }
  if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim())) errors.push("title must be a non-empty string.");
  if (input.dateTimeStart !== undefined && (typeof input.dateTimeStart !== "string" || Number.isNaN(Date.parse(input.dateTimeStart)))) errors.push("dateTimeStart must be a valid ISO datetime string.");
  if (input.dateTimeEnd !== undefined && (typeof input.dateTimeEnd !== "string" || Number.isNaN(Date.parse(input.dateTimeEnd)))) errors.push("dateTimeEnd must be a valid ISO datetime string.");
  if (input.notes !== undefined && typeof input.notes !== "string") errors.push("notes must be a string.");
  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<CalendarUpdateEventHandlerOutput>["status"],
  code: string,
  message: string,
  eventId?: string,
): AgentWriteToolExecutionResult<CalendarUpdateEventHandlerOutput> {
  return {
    status,
    success: false,
    error: executionError(code, message),
    auditMetadata: { taskId: eventId, verified: false, resultShape: "object", redacted: true },
  };
}

export const calendarUpdateEventHandler: AgentWriteToolHandler<CalendarUpdateEventHandlerOutput> = {
  toolId: "calendar.update_event",
  mode: "write",
  timeoutMs: 3000,
  readOnly: false,
  externalEffect: true,
  reversible: true,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateCalendarUpdateInput(input);
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
  // applied. Now built from the Worker's own authoritative response
  // (outcome.title/notes/dateTimeStart/dateTimeEnd), which reflects the
  // row's real, just-persisted state.
  async execute(input: Record<string, unknown>, context: ExecutionContext = {}) {
    const validation = validateCalendarUpdateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "calendar.update_event input failed validation.");
    const eventId = String(input.eventId).trim();
    if (!context.agentToolExecutionClient || !context.pendingAgentExecutionId) {
      return failure("failed", "AGENT_EXECUTION_NOT_REQUESTED", "Server-owned execution was not requested before approval.", eventId);
    }

    try {
      const outcome = await context.agentToolExecutionClient.approveExecution(context.pendingAgentExecutionId);
      if (outcome.status !== "succeeded" || !outcome.title || !outcome.dateTimeStart) {
        return failure("failed", outcome.errorCode ?? "CALENDAR_EVENT_UPDATE_FAILED", outcome.reply || "Unable to update calendar event.", eventId);
      }
      return {
        status: "success",
        success: true,
        data: Object.freeze({ eventId, title: outcome.title, dateTimeStart: outcome.dateTimeStart, verified: true }),
        auditMetadata: { taskId: eventId, verified: true, resultShape: "object", redacted: true },
      };
    } catch (caught) {
      const error = caught as Partial<ExecutionError>;
      return failure("failed", typeof error.code === "string" ? error.code : "CALENDAR_EVENT_UPDATE_FAILED", typeof error.message === "string" ? error.message : "Unable to update calendar event.", eventId);
    }
  },
};
