import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
  ExecutionContext,
  ExecutionError,
  ExecutionInputValidationResult,
} from "../executionTypes";
import type { AgentToolSchemaField } from "../toolTypes";

export interface CalendarCreateEventHandlerOutput {
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

function validateCalendarCreateInput(input: unknown): ExecutionInputValidationResult {
  if (!isRecord(input)) return { valid: false, errors: ["Input must be an object."] };
  // userId is accepted for parity/audit-trail consistency with the task
  // handlers (writeRuntime.ts's buildHandlerInput always injects it as
  // runtimeActorId) even though calendarService itself resolves the
  // acting user internally via its own Supabase session, not this field.
  const allowed = new Set(["userId", "title", "dateTimeStart", "dateTimeEnd", "notes"]);
  const errors = Object.keys(input)
    .filter((key) => !allowed.has(key))
    .map((key) => `${key} is not allowed for calendar.create_event.`);
  if (typeof input.userId !== "string" || !input.userId.trim()) errors.push("userId is required.");
  if (typeof input.title !== "string" || !input.title.trim()) errors.push("title is required.");
  if (typeof input.dateTimeStart !== "string" || Number.isNaN(Date.parse(input.dateTimeStart))) errors.push("dateTimeStart must be a valid ISO datetime string.");
  if (input.dateTimeEnd !== undefined && (typeof input.dateTimeEnd !== "string" || Number.isNaN(Date.parse(input.dateTimeEnd)))) errors.push("dateTimeEnd must be a valid ISO datetime string.");
  if (input.notes !== undefined && typeof input.notes !== "string") errors.push("notes must be a string.");
  return { valid: errors.length === 0, errors };
}

function failure(
  status: AgentWriteToolExecutionResult<CalendarCreateEventHandlerOutput>["status"],
  code: string,
  message: string,
  eventId?: string,
): AgentWriteToolExecutionResult<CalendarCreateEventHandlerOutput> {
  return {
    status,
    success: false,
    error: executionError(code, message),
    // taskId reused as a generic id slot -- see AgentWriteToolAuditMetadata's
    // own definition; it is not task-specific in practice, only in name
    // (the tasks handlers were simply first to populate it).
    auditMetadata: { taskId: eventId, verified: false, resultShape: "object", redacted: true },
  };
}

export const calendarCreateEventHandler: AgentWriteToolHandler<CalendarCreateEventHandlerOutput> = {
  toolId: "calendar.create_event",
  mode: "write",
  timeoutMs: 3000,
  readOnly: false,
  externalEffect: true,
  reversible: true,
  requiresVerification: true,
  validateInput(input: unknown, _schema: readonly AgentToolSchemaField[]) {
    return validateCalendarCreateInput(input);
  },
  // Chat V2 Slice 2A / BLOCKER A CORRECTION: see tasksCreateHandler.ts's own
  // comment on this same change -- no direct-write fallback remains.
  async execute(input: Record<string, unknown>, context: ExecutionContext = {}) {
    const validation = validateCalendarCreateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "calendar.create_event input failed validation.");
    if (!context.agentToolExecutionClient) {
      return failure("failed", "AGENT_EXECUTION_CLIENT_UNAVAILABLE", "Server-owned execution is unavailable.");
    }
    const title = String(input.title).trim();
    const dateTimeStart = String(input.dateTimeStart);
    const dateTimeEnd = typeof input.dateTimeEnd === "string" ? input.dateTimeEnd : undefined;
    const notes = typeof input.notes === "string" ? input.notes : undefined;

    try {
      const outcome = await context.agentToolExecutionClient.requestAndExecute({
        toolId: "calendar.create_event",
        arguments: { title, dateTimeStart, dateTimeEnd, notes },
        requestId: crypto.randomUUID(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (outcome.status !== "succeeded" || !outcome.targetId) {
        return failure("failed", outcome.errorCode ?? "CALENDAR_EVENT_CREATE_FAILED", outcome.reply || "Unable to create calendar event.");
      }
      return {
        status: "success",
        success: true,
        data: Object.freeze({ eventId: outcome.targetId, title, dateTimeStart, verified: true }),
        auditMetadata: { taskId: outcome.targetId, verified: true, resultShape: "object", redacted: true },
      };
    } catch (caught) {
      const error = caught as Partial<ExecutionError>;
      return failure("failed", typeof error.code === "string" ? error.code : "CALENDAR_EVENT_CREATE_FAILED", typeof error.message === "string" ? error.message : "Unable to create calendar event.");
    }
  },
};
