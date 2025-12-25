import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export interface Task {
  id: string;
  title: string;
  notes?: string;
  dueDate?: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

function mapRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    dueDate: row.due_date ?? null,
    completed: row.completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const tasksService = {
  async listTasks(userId: string) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id,user_id,title,notes,due_date,completed,created_at,updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRowToTask);
  },
  async createTask(
    userId: string,
    input: { title: string; notes?: string; dueDate?: string | null },
  ) {
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        title: input.title.trim(),
        notes: input.notes?.trim() || null,
        due_date: input.dueDate ?? null,
        completed: false,
      })
      .select("id,user_id,title,notes,due_date,completed,created_at,updated_at")
      .single();
    if (error) throw error;
    return mapRowToTask(data as TaskRow);
  },
  async updateTask(
    userId: string,
    id: string,
    updates: { title?: string; notes?: string; dueDate?: string | null; completed?: boolean },
  ) {
    const nextNotes = updates.notes !== undefined ? updates.notes.trim() || null : undefined;
    const { data, error } = await supabase
      .from("tasks")
      .update({
        title: updates.title ? updates.title.trim() : undefined,
        notes: nextNotes,
        due_date: updates.dueDate === undefined ? undefined : updates.dueDate || null,
        completed: updates.completed ?? undefined,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id,user_id,title,notes,due_date,completed,created_at,updated_at")
      .single();
    if (error) throw error;
    return mapRowToTask(data as TaskRow);
  },
  async toggleTaskCompleted(userId: string, id: string, nextCompleted: boolean) {
    const { data, error } = await supabase
      .from("tasks")
      .update({ completed: nextCompleted })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id,user_id,title,notes,due_date,completed,created_at,updated_at")
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
