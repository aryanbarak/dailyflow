import { calendarService } from "@/features/calendar/calendarService";
import type {
  AgentWriteToolExecutionResult,
  AgentWriteToolHandler,
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
  async execute(input: Record<string, unknown>) {
    const validation = validateCalendarUpdateInput(input);
    if (!validation.valid) return failure("invalid_input", "INVALID_INPUT", "calendar.update_event input failed validation.");
    const eventId = String(input.eventId).trim();
    try {
      const updates = {
        ...(typeof input.title === "string" ? { title: input.title } : {}),
        ...(typeof input.dateTimeStart === "string" ? { dateTimeStart: input.dateTimeStart } : {}),
        ...(typeof input.dateTimeEnd === "string" ? { dateTimeEnd: input.dateTimeEnd } : {}),
        ...(typeof input.notes === "string" ? { notes: input.notes } : {}),
      };
      const updated = await calendarService.update(eventId, updates);
      if (!updated) return failure("failed", "CALENDAR_EVENT_UPDATE_FAILED", "Unable to update calendar event.", eventId);
      const all = await calendarService.getAll();
      const verified = all.some((event) => event.id === updated.id && event.updatedAt === updated.updatedAt);
      if (!verified) return failure("verification_failed", "VERIFICATION_FAILED", "Updated event could not be verified.", eventId);
      return {
        status: "success",
        success: true,
        data: Object.freeze({ eventId, title: updated.title, dateTimeStart: updated.dateTimeStart, verified: true }),
        auditMetadata: { taskId: eventId, verified: true, resultShape: "object", redacted: true },
        // No compensation descriptor -- see calendarCreateEventHandler.ts's
        // own comment; the shared type is task-completion-shaped.
      };
    } catch {
      return failure("failed", "CALENDAR_EVENT_UPDATE_FAILED", "Unable to update calendar event.", eventId);
    }
  },
};
