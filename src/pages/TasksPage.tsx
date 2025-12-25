import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Calendar, Trash2, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTasks } from "@/hooks/useTasks";
import { Task } from "@/features/tasks/tasksService";
import { formatDateLabel, isBeforeDay, isSameDay } from "@/lib/date";
import { cn } from "@/lib/utils";

type TaskFilter = "all" | "today" | "overdue" | "completed";

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00`);
}

export default function TasksPage() {
  const { tasks, isLoading, error, addTask, updateTask, toggleTaskCompleted, deleteTask } = useTasks();
  const [filter, setFilter] = useState<TaskFilter>("today");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const today = new Date();

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filter === "completed") return task.completed;
      if (filter === "today") {
        return task.dueDate ? isSameDay(parseDateOnly(task.dueDate), today) : false;
      }
      if (filter === "overdue") {
        return task.dueDate
          ? !task.completed && isBeforeDay(parseDateOnly(task.dueDate), today)
          : false;
      }
      return true;
    });
  }, [tasks, filter, today]);

  const counts = useMemo(() => {
    const todayCount = tasks.filter((task) => task.dueDate && isSameDay(parseDateOnly(task.dueDate), today)).length;
    const overdueCount = tasks.filter(
      (task) => task.dueDate && !task.completed && isBeforeDay(parseDateOnly(task.dueDate), today),
    ).length;
    const completedCount = tasks.filter((task) => task.completed).length;
    return { todayCount, overdueCount, completedCount };
  }, [tasks, today]);

  const openNewTask = () => {
    setEditingTask(null);
    setTitle("");
    setNotes("");
    setDueDate("");
    setFormError(null);
    setIsDialogOpen(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setDueDate(task.dueDate ?? "");
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setFormError("Task title is required.");
      return;
    }
    if (editingTask) {
      await updateTask(editingTask.id, { title: trimmed, notes, dueDate: dueDate || null });
    } else {
      await addTask({ title: trimmed, notes, dueDate: dueDate || null });
    }
    setIsDialogOpen(false);
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await deleteTask(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const dueLabel = (task: Task) => {
    if (!task.dueDate) return "No due date";
    const date = parseDateOnly(task.dueDate);
    if (isSameDay(date, today)) return "Due today";
    if (!task.completed && isBeforeDay(date, today)) return "Overdue";
    return `Due ${formatDateLabel(task.dueDate)}`;
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Tasks</h1>
          <p className="text-muted-foreground">Manage your to-dos and reminders</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 shadow-glow" onClick={openNewTask}>
              <Plus className="w-4 h-4" />
              Add Task
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingTask ? "Edit Task" : "New Task"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>Task Title</Label>
                <Input
                  placeholder="What needs to be done?"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  placeholder="Optional details"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </div>
              <Button className="w-full" onClick={handleSave}>
                {editingTask ? "Save Changes" : "Create Task"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading tasks...
        </div>
      ) : null}

      <Tabs value={filter} onValueChange={(value) => setFilter(value as TaskFilter)} className="space-y-6">
        <TabsList className="bg-secondary">
          <TabsTrigger value="all">All ({tasks.length})</TabsTrigger>
          <TabsTrigger value="today">Today ({counts.todayCount})</TabsTrigger>
          <TabsTrigger value="overdue">Overdue ({counts.overdueCount})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({counts.completedCount})</TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="space-y-3">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex items-center gap-3 p-4 rounded-lg transition-all group",
                  task.completed ? "bg-secondary/50" : "bg-secondary hover:bg-card-hover",
                )}
              >
                <Checkbox checked={task.completed} onCheckedChange={() => toggleTaskCompleted(task.id)} />
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-medium", task.completed && "line-through text-muted-foreground")}>
                    {task.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {dueLabel(task)}
                    </span>
                  </div>
                </div>
                <Badge variant="outline" className={cn("text-xs shrink-0", task.completed && "border-muted")}>
                  {task.completed ? "Done" : "Open"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  onClick={() => openEditTask(task)}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteTarget(task)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </motion.div>
            ))
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No tasks in this view</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{deleteTarget?.title}" from your list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
