import { calendarService } from "@/features/calendar/calendarService";
import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
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
  async execute(input: Record<string, unknown>) {
    const validation = validateCalendarCreateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "calendar.create_event input failed validation.");
    const title = String(input.title).trim();
    const dateTimeStart = String(input.dateTimeStart);
    const dateTimeEnd = typeof input.dateTimeEnd === "string" ? input.dateTimeEnd : undefined;
    const notes = typeof input.notes === "string" ? input.notes : undefined;
    try {
      const created = await calendarService.create({ title, dateTimeStart, dateTimeEnd, notes });
      // calendarService.create() has no dedicated "get by id" readback
      // (unlike tasksService.getTaskForUser) and silently falls back to
      // localStorage if the Supabase insert fails for any reason -- so an
      // independent read via getAll() (the only listing method available)
      // is the closest equivalent verification: confirms the row is
      // actually visible through the same read path the real calendar UI
      // uses, not just that create() returned an object.
      const all = await calendarService.getAll();
      const verified = all.some((event) => event.id === created.id && event.title === created.title);
      if (!verified) return failure("verification_failed", "VERIFICATION_FAILED", "Created event could not be verified.", created.id);
      return {
        status: "success",
        success: true,
        data: Object.freeze({ eventId: created.id, title: created.title, dateTimeStart: created.dateTimeStart, verified: true }),
        auditMetadata: { taskId: created.id, verified: true, resultShape: "object", redacted: true },
        // No compensation descriptor: AgentWriteToolCompensationDescriptor
        // is shaped for task-completion undo (previousCompleted/
        // previousCompletedAt), which has no calendar-event equivalent --
        // omitted here for the same reason the GitHub write handlers omit
        // it, rather than populating it with meaningless placeholder data.
      };
    } catch {
      return failure("failed", "CALENDAR_EVENT_CREATE_FAILED", "Unable to create calendar event.");
    }
  },
};
