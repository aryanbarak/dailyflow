import { useCallback, useEffect, useState } from "react";
import { Task, tasksService } from "@/features/tasks/tasksService";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/hooks/use-toast";

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
      const message = err instanceof Error ? err.message : String(err);
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
    async (payload: { title: string; notes?: string; dueDate?: string | null }) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return null;
      }
      try {
        const created = await tasksService.createTask(user.id, payload);
        setTasks((prev) => [created, ...prev]);
        return created;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
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
      patch: { title?: string; notes?: string; dueDate?: string | null; completed?: boolean },
    ) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return null;
      }
      try {
        const updated = await tasksService.updateTask(user.id, id, patch);
        setTasks((prev) => prev.map((task) => (task.id === id ? updated : task)));
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Failed to update task", err);
        toast({
          variant: "destructive",
          title: "Failed to update task",
          description: message,
        });
        return null;
      }
    },
    [user, toast],
  );

  const toggleTaskCompleted = useCallback(
    async (id: string) => {
      if (!user) {
        toast({ variant: "destructive", title: "You must be signed in" });
        return null;
      }
      const current = tasks.find((task) => task.id === id);
      if (!current) return null;
      const nextCompleted = !current.completed;
      try {
        const updated = await tasksService.toggleTaskCompleted(user.id, id, nextCompleted);
        setTasks((prev) => prev.map((task) => (task.id === id ? updated : task)));
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
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
      try {
        await tasksService.deleteTask(user.id, id);
        setTasks((prev) => prev.filter((task) => task.id !== id));
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Failed to delete task", err);
        toast({
          variant: "destructive",
          title: "Failed to delete task",
          description: message,
        });
        return false;
      }
    },
    [user, toast],
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
