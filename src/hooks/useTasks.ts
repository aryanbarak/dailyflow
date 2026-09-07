import { useCallback, useEffect, useState } from "react";
import { Task, tasksService } from "@/features/tasks/tasksService";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";

export function useTasks() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    if (!user) {
      setTasks([]);
      setIsLoading(false);
      return;
    }
    try {
      const data = await tasksService.listTasks(user.id);
      setTasks(data);
    } catch (err) {
      const message = getErrorMessage(err);
      console.error("Failed to load tasks", err);
      setError(message);
      toast({
        variant: "destructive",
        title: "Failed to load tasks",
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    refresh();
  }, [refresh, user]);

  const addTask = useCallback(
    async (payload: { title: string; notes?: string; dueDate?: string | null; recurrenceRule?: string; recurrenceEndDate?: string }) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return null;
      }
      const now = new Date().toISOString();
      const tempId = `__temp_${now}`;
      const tempTask: Task = {
        id: tempId,
        title: payload.title,
        notes: payload.notes,
        dueDate: payload.dueDate,
        completed: false,
        createdAt: now,
        updatedAt: now,
      };
      setTasks((prev) => [tempTask, ...prev]);
      try {
        const created = await tasksService.createTask(user.id, payload);
        setTasks((prev) => prev.map((t) => (t.id === tempId ? created : t)));
        return created;
      } catch (err) {
        setTasks((prev) => prev.filter((t) => t.id !== tempId));
        const message = getErrorMessage(err);
        console.error("Failed to create task", err);
        toast({
          variant: "destructive",
          title: "Failed to create task",
          description: message,
        });
        return null;
      }
    },
    [user, toast],
  );

  const updateTask = useCallback(
    async (
      id: string,
      patch: {
        title?: string;
        notes?: string;
        dueDate?: string | null;
        completed?: boolean;
        recurrenceRule?: string | null;
        recurrenceEndDate?: string | null;
      },
    ) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return null;
      }
      const snapshot = tasks;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      try {
        const updated = await tasksService.updateTask(user.id, id, patch);
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
        return updated;
      } catch (err) {
        setTasks(snapshot);
        const message = getErrorMessage(err);
        console.error("Failed to update task", err);
        toast({
          variant: "destructive",
          title: "Failed to update task",
          description: message,
        });
        return null;
      }
    },
    [user, tasks, toast],
  );

  const toggleTaskCompleted = useCallback(
    async (id: string) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return null;
      }
      const current = tasks.find((t) => t.id === id);
      if (!current) return null;
      const snapshot = tasks;
      const nextCompleted = !current.completed;
      const nextCompletedAt = nextCompleted ? new Date().toISOString() : null;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: nextCompleted, completedAt: nextCompletedAt } : t)));
      try {
        const updated = await tasksService.toggleTaskCompleted(user.id, id, nextCompleted);
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
        return updated;
      } catch (err) {
        setTasks(snapshot);
        const message = getErrorMessage(err);
        console.error("Failed to toggle task", err);
        toast({
          variant: "destructive",
          title: "Failed to update task",
          description: message,
        });
        return null;
      }
    },
    [user, tasks, toast],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return false;
      }
      const snapshot = tasks;
      setTasks((prev) => prev.filter((t) => t.id !== id));
      try {
        await tasksService.deleteTask(user.id, id);
        return true;
      } catch (err) {
        setTasks(snapshot);
        const message = getErrorMessage(err);
        console.error("Failed to delete task", err);
        toast({
          variant: "destructive",
          title: "Failed to delete task",
          description: message,
        });
        return false;
      }
    },
    [user, tasks, toast],
  );

  return {
    tasks,
    isLoading,
    error,
    refresh,
    addTask,
    updateTask,
    toggleTaskCompleted,
    deleteTask,
  };
}
