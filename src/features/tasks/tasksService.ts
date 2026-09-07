import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export interface Task {
  id: string;
  title: string;
  notes?: string;
  dueDate?: string | null;
  // CORE-W5 (2026-09-06, CORE audit item 1-4): a real RFC 5545 RRULE
  // property list (no "RRULE:" prefix, no DTSTART -- see
  // src/features/scheduling/occurrences.ts), replacing the old inert
  // enum. recurrenceEndDate maps to the RRULE's UNTIL boundary.
  recurrenceRule?: string | null;
  recurrenceEndDate?: string | null;
  completed: boolean;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

export type TaskServiceErrorCode =
  | "INVALID_TASK_INPUT"
  | "TASK_NOT_FOUND"
  | "TASK_READ_FAILED"
  | "TASK_COMPLETE_FAILED";

export class TaskServiceError extends Error {
  readonly code: TaskServiceErrorCode;
  readonly retryable: boolean;

  constructor(code: TaskServiceErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "TaskServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

function mapRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    dueDate: row.due_date ?? null,
    recurrenceRule: (row as Record<string, unknown>).recurrence_rule as string | null ?? null,
    recurrenceEndDate: (row as Record<string, unknown>).recurrence_end_date as string | null ?? null,
    completed: row.completed,
    completedAt: (row as Record<string, unknown>).completed_at as string | null ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeRequiredId(value: string, field: "userId" | "taskId") {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TaskServiceError(
      "INVALID_TASK_INPUT",
      `${field} is required.`,
    );
  }
  return value.trim();
}

function normalizeError(
  error: unknown,
  code: TaskServiceErrorCode,
  message: string,
): TaskServiceError {
  if (error instanceof TaskServiceError) return error;
  return new TaskServiceError(code, message);
}

const TASK_SELECT_COLUMNS = "id,user_id,title,notes,due_date,recurrence_rule,recurrence_end_date,completed,completed_at,created_at,updated_at";

async function readOwnedTask(userId: string, taskId: string) {
  const normalizedUserId = normalizeRequiredId(userId, "userId");
  const normalizedTaskId = normalizeRequiredId(taskId, "taskId");
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_SELECT_COLUMNS)
    .eq("id", normalizedTaskId)
    .eq("user_id", normalizedUserId)
    .maybeSingle();

  if (error) {
    throw normalizeError(error, "TASK_READ_FAILED", "Unable to load task.");
  }
  if (!data) {
    throw new TaskServiceError("TASK_NOT_FOUND", "Task was not found for this user.");
  }

  return mapRowToTask(data as TaskRow);
}

export const tasksService = {
  async listTasks(userId: string) {
    const { data, error } = await supabase
      .from("tasks")
      .select(TASK_SELECT_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRowToTask);
  },
  async createTask(
    userId: string,
    input: { title: string; notes?: string; dueDate?: string | null; recurrenceRule?: string; recurrenceEndDate?: string },
  ) {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        title: input.title.trim(),
        notes: input.notes?.trim() || null,
        due_date: input.dueDate ?? null,
        completed: false,
        ...(input.recurrenceRule ? { recurrence_rule: input.recurrenceRule, recurrence_end_date: input.recurrenceEndDate ?? null } : {}),
      })
      .select(TASK_SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return mapRowToTask(data as TaskRow);
  },
  async updateTask(
    userId: string,
    id: string,
    updates: {
      title?: string;
      notes?: string;
      dueDate?: string | null;
      completed?: boolean;
      recurrenceRule?: string | null;
      recurrenceEndDate?: string | null;
    },
  ) {
    const nextNotes = updates.notes !== undefined ? updates.notes.trim() || null : undefined;
    const { data, error } = await supabase
      .from("tasks")
      .update({
        title: updates.title ? updates.title.trim() : undefined,
        notes: nextNotes,
        due_date: updates.dueDate === undefined ? undefined : updates.dueDate || null,
        completed: updates.completed ?? undefined,
        recurrence_rule: updates.recurrenceRule,
        recurrence_end_date: updates.recurrenceEndDate,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select(TASK_SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return mapRowToTask(data as TaskRow);
  },
  async getTaskForUser(userId: string, taskId: string) {
    return readOwnedTask(userId, taskId);
  },
  async completeTask(userId: string, taskId: string) {
    const normalizedUserId = normalizeRequiredId(userId, "userId");
    const normalizedTaskId = normalizeRequiredId(taskId, "taskId");
    const existingTask = await readOwnedTask(normalizedUserId, normalizedTaskId);

    if (existingTask.completed) {
      return existingTask;
    }

    const completedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("tasks")
      .update({
        completed: true,
        completed_at: completedAt,
      })
      .eq("id", normalizedTaskId)
      .eq("user_id", normalizedUserId)
      .select(TASK_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      throw normalizeError(error, "TASK_COMPLETE_FAILED", "Unable to complete task.");
    }

    return mapRowToTask(data as TaskRow);
  },
  async toggleTaskCompleted(userId: string, id: string, nextCompleted: boolean) {
    const { data, error } = await supabase
      .from("tasks")
      .update({
        completed: nextCompleted,
        completed_at: nextCompleted ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select(TASK_SELECT_COLUMNS)
      .single();
    if (error) throw error;
    return mapRowToTask(data as TaskRow);
  },
  async deleteTask(userId: string, id: string) {
    const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", userId);
    if (error) throw error;
    return true;
  },
};
