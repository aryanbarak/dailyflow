import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlarmPicker } from "@/features/calendar/components/AlarmPicker";
import { motion } from "framer-motion";
import { Plus, Calendar, Trash2, Pencil, CheckSquare, ListTodo, CalendarClock, TrendingUp, TrendingDown, Target, Sparkles, ArrowRight, BarChart3, Lightbulb, MessageSquare, Send, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatePanel } from "@/components/common/StatePanel";
import { SkeletonListItem } from "@/components/common/Skeletons";
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
import { usePullToRefreshHandler } from "@/features/pull-to-refresh/PullToRefreshContext";
import { Task } from "@/features/tasks/tasksService";
import { SmartAcademyWidget } from "@/components/dashboard/SmartAcademyWidget";
import { useChatSessions } from "@/hooks/useChatSessions";
import { supabase } from "@/integrations/supabase/client";
import { SkeletonBlock } from "@/components/common/Skeletons";
import { RecurrencePicker } from "@/components/RecurrencePicker";
import type { RecurrenceRule } from "@/lib/recurrence";
import { formatDateLabel, isBeforeDay, isSameDay, toDateOnly } from "@/lib/date";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";
import { useAppearance } from "@/features/settings/appearanceStore";
import { createDirectionalMarkdownComponents } from "@/lib/bidiText";
import {
  getAiResponseLanguageInstruction,
  getStoredAiResponseLanguage,
  resolveAiResponseLanguage,
  withAiResponseLanguageInstruction,
  type SupportedAiResponseLanguage,
} from "@/features/ai/responseLanguage";

type TaskFilter = "all" | "today" | "upcoming" | "overdue" | "completed";

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00`);
}

// Task 11e (bidi rendering): direction-handling lives in the shared
// createDirectionalMarkdownComponents utility (src/lib/bidiText.tsx), used
// identically by ChatPage, AgentBriefingCard, and WeeklyBriefingPage. Only
// the visual class names below are specific to this page. `ps-4` (logical
// padding-start) replaces the previous physical `pl-4`.
// Exported (task 17f) purely so this consumer's direction-aware markdown
// wiring can be verified directly against bidiText.tsx's behavior in tests
// without mounting the full page (auth/supabase-heavy) -- no runtime change.
export const TASK_MD_COMPONENTS = createDirectionalMarkdownComponents({
  p: "mb-1 last:mb-0",
  ul: "list-disc ps-4 mt-1 space-y-0.5",
});

export function buildTaskAssistantRequestBody(input: {
  context: string;
  question: string;
  sessionId: string;
  responseLanguage: SupportedAiResponseLanguage;
}) {
  const responseLanguageInstruction = getAiResponseLanguageInstruction(input.responseLanguage);
  const taskMessage = `${input.context}\nUser question: ${input.question}`;

  return {
    message: withAiResponseLanguageInstruction(taskMessage, input.responseLanguage),
    session_id: input.sessionId,
    responseLanguage: input.responseLanguage,
    responseLanguageInstruction,
  };
}

export default function TasksPage() {
  const { tasks, isLoading, error, refresh, addTask, updateTask, toggleTaskCompleted, deleteTask } = useTasks();
  // Task 38, point 8: opts this route into the shared pull-to-refresh
  // gesture -- `refresh` only re-fetches and replaces the `tasks` array
  // (useTasks.ts), it never touches this page's own local dialog state
  // (isDialogOpen/editingTask/deleteTarget below), so a mid-edit pull can't
  // clear an open dialog (task 38, point 9).
  usePullToRefreshHandler(refresh);
  const { t } = useT();
  const interfaceLanguage = useAppearance((state) => state.language);
  const [filter, setFilter] = useState<TaskFilter>("today");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | ''>('');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [statsRange, setStatsRange] = useState<'week' | 'month' | 'all'>('week');

  const today = new Date();
  const isInitialLoading = isLoading && tasks.length === 0;

  const weekEnd = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  }, []);

  const counts = useMemo(() => {
    const open = tasks.filter(t => !t.completed).length;
    const todayCount = tasks.filter(t => t.dueDate && isSameDay(parseDateOnly(t.dueDate), today)).length;
    const overdueCount = tasks.filter(
      t => t.dueDate && !t.completed && isBeforeDay(parseDateOnly(t.dueDate), today),
    ).length;
    const upcomingCount = tasks.filter(t => {
      if (!t.dueDate || t.completed) return false;
      const d = parseDateOnly(t.dueDate);
      return !isSameDay(d, today) && !isBeforeDay(d, today) && d <= weekEnd;
    }).length;
    const completedCount = tasks.filter(t => t.completed).length;
    const rate = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
    return { open, todayCount, upcomingCount, overdueCount, completedCount, rate };
  }, [tasks, today, weekEnd]);

  const todayStr = useMemo(() => toDateOnly(today), [today]);
  const focusTasks = useMemo(() => {
    return tasks
      .filter(t => t.dueDate && t.dueDate <= todayStr)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
      .slice(0, 3);
  }, [tasks, todayStr]);
  const focusDone = focusTasks.filter(t => t.completed).length;
  const focusTotal = focusTasks.length;

  // AI Suggestions — fetched from Gemini via worker
  const [aiSuggestions, setAiSuggestions] = useState<Array<{ text: string; type: string }>>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const suggestionsLoaded = useRef(false);
  const workerUrl = import.meta.env.VITE_AGENT_WORKER_URL as string;

  useEffect(() => {
    if (suggestionsLoaded.current || tasks.length === 0 || isLoading) return;
    suggestionsLoaded.current = true;
    setSuggestionsLoading(true);
    supabase.auth.getSession().then(({ data: { session: authSession } }) => {
      if (!authSession) { setSuggestionsLoading(false); return; }
      const responseLanguage = resolveAiResponseLanguage({
        configuredResponseLanguage: getStoredAiResponseLanguage(),
        interfaceLanguage,
      });
      fetch(`${workerUrl}/tasks/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession.access_token}` },
        body: JSON.stringify({
          responseLanguage,
          responseLanguageInstruction: getAiResponseLanguageInstruction(responseLanguage),
        }),
      })
        .then(res => res.ok ? res.json() : { suggestions: [] })
        .then((body: { suggestions: Array<{ text: string; type: string }> }) => {
          setAiSuggestions(body.suggestions ?? []);
        })
        .catch(() => setAiSuggestions([]))
        .finally(() => setSuggestionsLoading(false));
    });
  }, [tasks.length, isLoading, workerUrl, interfaceLanguage]);

  // Task chat — compact ask-and-answer
  const navigate = useNavigate();
  const { createSession } = useChatSessions();
  const [taskQuestion, setTaskQuestion] = useState('');
  const [taskAnswer, setTaskAnswer] = useState<string | null>(null);
  const [taskAnswerLanguage, setTaskAnswerLanguage] = useState<SupportedAiResponseLanguage | null>(null);
  const [taskChatSessionId, setTaskChatSessionId] = useState<string | null>(null);
  const [taskChatSending, setTaskChatSending] = useState(false);

  const buildTaskContext = useCallback(() => {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toDateOnly(tomorrow);

    const open = tasks.filter(t => !t.completed);
    const dueToday = open.filter(t => t.dueDate && t.dueDate === todayStr).map(t => t.title).slice(0, 10);
    const dueTomorrow = open.filter(t => t.dueDate && t.dueDate === tomorrowStr).map(t => t.title).slice(0, 10);
    const dueThisWeek = open.filter(t => {
      if (!t.dueDate) return false;
      const d = parseDateOnly(t.dueDate);
      return !isSameDay(d, today) && d.toISOString().slice(0, 10) !== tomorrowStr && !isBeforeDay(d, today) && d <= weekEnd;
    }).map(t => `${t.title} (${t.dueDate})`).slice(0, 10);
    const overdue = open.filter(t => t.dueDate && isBeforeDay(parseDateOnly(t.dueDate), today))
      .map(t => `${t.title} (was due ${t.dueDate})`).slice(0, 10);
    const noDue = open.filter(t => !t.dueDate).map(t => t.title).slice(0, 5);

    const lines: string[] = ['[Task context — use this real data to answer accurately:'];
    if (dueToday.length > 0) lines.push(`Due today: ${dueToday.join(', ')}`);
    if (dueTomorrow.length > 0) lines.push(`Due tomorrow: ${dueTomorrow.join(', ')}`);
    if (dueThisWeek.length > 0) lines.push(`Due this week: ${dueThisWeek.join(', ')}`);
    if (overdue.length > 0) lines.push(`Overdue: ${overdue.join(', ')}`);
    if (noDue.length > 0) lines.push(`No due date: ${noDue.join(', ')}`);
    lines.push(`Open: ${open.length}, Completed: ${tasks.length - open.length}]`);
    return lines.join('\n');
  }, [tasks, today, todayStr, weekEnd]);

  const handleAskAboutTasks = useCallback(async () => {
    const q = taskQuestion.trim();
    if (!q || taskChatSending) return;
    const responseLanguage = resolveAiResponseLanguage({
      configuredResponseLanguage: getStoredAiResponseLanguage(),
      latestUserMessage: q,
      interfaceLanguage,
    });
    setTaskChatSending(true);
    setTaskAnswer(null);
    setTaskAnswerLanguage(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession) throw new Error('No session');
      const sessionId = await createSession(`Tasks: ${q.slice(0, 30)}`);
      if (!sessionId) throw new Error('Failed to create session');
      setTaskChatSessionId(sessionId);
      const context = buildTaskContext();
      const res = await fetch(`${workerUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authSession.access_token}` },
        body: JSON.stringify(buildTaskAssistantRequestBody({
          context,
          question: q,
          sessionId,
          responseLanguage,
        })),
      });
      if (!res.ok) throw new Error(`Worker ${res.status}`);
      const { reply } = await res.json() as { reply: string };
      setTaskAnswer(reply);
      setTaskAnswerLanguage(responseLanguage);
      setTaskQuestion('');
    } catch {
      setTaskAnswer(t('chat_error_send'));
    } finally {
      setTaskChatSending(false);
    }
  }, [taskQuestion, taskChatSending, workerUrl, createSession, buildTaskContext, t, interfaceLanguage]);

  const prodStats = useMemo(() => {
    const now = new Date();

    if (statsRange === 'all') {
      const total = tasks.filter(t => t.completed).length;
      return {
        current: total,
        currentLabel: 'Total completed',
        previous: null,
        previousLabel: null,
        pct: null,
        hasData: total > 0,
        extra: `${counts.rate}% completion rate`,
      };
    }

    if (statsRange === 'month') {
      const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

      const curCount = tasks.filter(t =>
        t.completedAt && t.completedAt.startsWith(curMonth)
      ).length;
      const prevCount = tasks.filter(t =>
        t.completedAt && t.completedAt.startsWith(prevMonth)
      ).length;
      const hasData = curCount > 0 || prevCount > 0;
      const pct = prevCount > 0 ? Math.round(((curCount - prevCount) / prevCount) * 100) : null;
      return {
        current: curCount,
        currentLabel: 'This month',
        previous: prevCount,
        previousLabel: 'Last month',
        pct,
        hasData,
        extra: null,
      };
    }

    // week (default)
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const nowMs = now.getTime();
    const curCount = tasks.filter(t =>
      t.completedAt && (nowMs - new Date(t.completedAt).getTime()) <= weekMs
    ).length;
    const prevCount = tasks.filter(t => {
      if (!t.completedAt) return false;
      const age = nowMs - new Date(t.completedAt).getTime();
      return age > weekMs && age <= weekMs * 2;
    }).length;
    const hasData = curCount > 0 || prevCount > 0;
    const pct = prevCount > 0 ? Math.round(((curCount - prevCount) / prevCount) * 100) : null;
    return {
      current: curCount,
      currentLabel: 'This week',
      previous: prevCount,
      previousLabel: 'Last week',
      pct,
      hasData,
      extra: null,
    };
  }, [tasks, statsRange, counts.rate]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filter === "completed") return task.completed;
      if (filter === "today") {
        return task.dueDate ? isSameDay(parseDateOnly(task.dueDate), today) : false;
      }
      if (filter === "upcoming") {
        if (!task.dueDate || task.completed) return false;
        const d = parseDateOnly(task.dueDate);
        return !isSameDay(d, today) && !isBeforeDay(d, today) && d <= weekEnd;
      }
      if (filter === "overdue") {
        return task.dueDate
          ? !task.completed && isBeforeDay(parseDateOnly(task.dueDate), today)
          : false;
      }
      return true;
    });
  }, [tasks, filter, today, weekEnd]);

  const openNewTask = () => {
    setEditingTask(null);
    setTitle("");
    setNotes("");
    setDueDate("");
    setRecurrenceRule('');
    setRecurrenceEndDate('');
    setFormError(null);
    setIsDialogOpen(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setDueDate(task.dueDate ?? "");
    setRecurrenceRule('');
    setRecurrenceEndDate('');
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
      await addTask({ title: trimmed, notes, dueDate: dueDate || null, recurrenceRule: recurrenceRule || undefined, recurrenceEndDate: recurrenceEndDate || undefined });
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

  const FILTERS: { value: TaskFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: tasks.length },
    { value: "today", label: "Today", count: counts.todayCount },
    { value: "upcoming", label: "Upcoming", count: counts.upcomingCount },
    { value: "overdue", label: "Overdue", count: counts.overdueCount },
    { value: "completed", label: "Completed", count: counts.completedCount },
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between py-5"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">Tasks</h1>
          <p className="text-sm text-muted-foreground">Manage your to-dos and reminders</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" style={{ background: 'var(--gradient-primary)' }} onClick={openNewTask}>
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
              <RecurrencePicker
                value={recurrenceRule}
                onChange={setRecurrenceRule}
                endDate={recurrenceEndDate}
                onEndDateChange={setRecurrenceEndDate}
              />
              <Button className="w-full" onClick={handleSave}>
                {editingTask ? "Save Changes" : "Create Task"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
        {/* Left column — stats + Today's Focus + filters + task list */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md">
                    <ListTodo className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Total</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{tasks.length}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md">
                    <CheckSquare className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Open</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{counts.open}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md">
                    <CalendarClock className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Due This Week</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{counts.upcomingCount + counts.todayCount}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md">
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Completion</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{counts.rate}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Today's Focus — horizontal card */}
          {focusTotal > 0 && (
            <Card className="glass-card card-accent">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Left — icon + title */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="icon-tile w-10 h-10 rounded-lg">
                      <Target className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Today&apos;s Focus</p>
                      <p className="text-[11px] text-muted-foreground">
                        Complete these important tasks today to stay on track.
                      </p>
                    </div>
                  </div>

                  {/* Middle — task checkboxes */}
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    {focusTasks.map(task => (
                      <div key={task.id} className="flex items-center gap-2">
                        <Checkbox
                          checked={task.completed}
                          onCheckedChange={() => toggleTaskCompleted(task.id)}
                          className="shrink-0"
                        />
                        <span className={cn(
                          "text-sm truncate",
                          task.completed && "line-through text-muted-foreground"
                        )}>
                          {task.title}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Right — progress ring */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className="relative w-14 h-14">
                      <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
                        <circle cx="28" cy="28" r="24" fill="none" stroke="hsl(var(--muted))" strokeWidth="4" />
                        <circle
                          cx="28" cy="28" r="24" fill="none"
                          stroke="hsl(var(--primary))"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={`${(focusDone / focusTotal) * 150.8} 150.8`}
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                        {focusDone}/{focusTotal}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Completed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <StatePanel
              variant="error"
              title="Unable to load tasks"
              description={error}
            />
          )}

          {/* Filter tabs */}
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f.value
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "glass-card hover:bg-secondary/40"
                )}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>

          {/* Task list */}
          <div className="space-y-2">
            {isInitialLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <SkeletonListItem key={idx} />
                ))}
              </div>
            ) : filteredTasks.length > 0 ? (
              filteredTasks.map((task) => (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "glass-card flex items-center gap-3 p-3.5 rounded-xl transition-all group",
                    task.completed && "opacity-60",
                  )}
                >
                  <Checkbox checked={task.completed} onCheckedChange={() => toggleTaskCompleted(task.id)} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium truncate", task.completed && "line-through text-muted-foreground")}>
                      {task.title}
                    </p>
                    {task.notes && (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{task.notes}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {dueLabel(task)}
                      </span>
                      {task.dueDate && !task.completed && (
                        <AlarmPicker
                          sourceType="task"
                          sourceId={task.id}
                          sourceTitle={task.title}
                          eventAt={`${task.dueDate}T09:00:00`}
                        />
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] shrink-0",
                      task.completed ? "border-muted text-muted-foreground" : "border-primary/30 text-primary"
                    )}
                  >
                    {task.completed ? "Done" : "Open"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground h-8 w-8"
                    onClick={() => openEditTask(task)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive h-8 w-8"
                    onClick={() => setDeleteTarget(task)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </motion.div>
              ))
            ) : (
              <div className="max-w-md mx-auto">
                <StatePanel
                  variant="empty"
                  title="No tasks in this view"
                  description="Try a different filter or add a new task."
                  actionLabel="Add task"
                  onAction={openNewTask}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-full lg:w-[300px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* AI Suggestions — Gemini-generated */}
          {(suggestionsLoading || aiSuggestions.length > 0) && (
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="icon-tile w-7 h-7 rounded-md">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-semibold">AI Suggestions</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Based on your tasks and goals</p>
                {suggestionsLoading ? (
                  <div className="space-y-2">
                    <SkeletonBlock className="h-10 w-full" />
                    <SkeletonBlock className="h-10 w-full" />
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {aiSuggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-3 rounded-lg bg-secondary/20 px-3 py-2.5">
                        <div className={cn("icon-tile w-7 h-7 rounded-lg shrink-0 mt-0.5", s.type === 'recommendation' ? 'bg-[var(--flow-analyze-bg)]' : 'bg-[var(--flow-study-bg)]')}>
                          {s.type === 'recommendation'
                            ? <ArrowRight className="w-3.5 h-3.5 text-[var(--flow-analyze)]" />
                            : <Lightbulb className="w-3.5 h-3.5 text-[var(--flow-study)]" />}
                        </div>
                        <p className="text-xs leading-relaxed">{s.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* Ask about tasks — compact chat */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="icon-tile w-7 h-7 rounded-md">
                  <MessageSquare className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="text-sm font-semibold">Ask about your tasks</span>
              </div>
              {taskAnswer && (
                <div className="rounded-lg bg-secondary/20 px-3 py-2.5 text-xs leading-relaxed" dir="auto" lang={taskAnswerLanguage ?? undefined}>
                  <ReactMarkdown components={TASK_MD_COMPONENTS}>
                    {taskAnswer.replace(/^•\s*/gm, '- ')}
                  </ReactMarkdown>
                </div>
              )}
              {taskChatSessionId && taskAnswer && (
                <button
                  type="button"
                  onClick={() => navigate(`/chat`)}
                  className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                >
                  Continue in Flow AI Chat
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              )}
              <div className="flex gap-2 items-end">
                <Input
                  value={taskQuestion}
                  onChange={e => setTaskQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAskAboutTasks(); } }}
                  placeholder="e.g. Which tasks should I focus on?"
                  disabled={taskChatSending}
                  className="text-xs h-8"
                />
                <Button
                  size="sm"
                  onClick={() => void handleAskAboutTasks()}
                  disabled={!taskQuestion.trim() || taskChatSending}
                  className="h-8 px-2.5 shrink-0"
                >
                  {taskChatSending
                    ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                    : <Send className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Productivity Stats — with time-range selector */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="icon-tile w-7 h-7 rounded-md">
                    <BarChart3 className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-semibold">Productivity Stats</span>
                </div>
                <Select value={statsRange} onValueChange={v => setStatsRange(v as 'week' | 'month' | 'all')}>
                  <SelectTrigger className="h-7 w-[110px] text-[11px] glass-card border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week" className="text-xs">This Week</SelectItem>
                    <SelectItem value="month" className="text-xs">This Month</SelectItem>
                    <SelectItem value="all" className="text-xs">All Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {prodStats.hasData ? (
                <ul className="space-y-3">
                  <li className="flex items-center gap-3">
                    <div className="icon-tile w-8 h-8 rounded-full bg-[var(--flow-analyze-bg)]">
                      <CheckSquare className="w-3.5 h-3.5 text-[var(--flow-analyze)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{prodStats.currentLabel}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {prodStats.current} completed
                      </p>
                    </div>
                    {prodStats.pct !== null && (
                      <div className={cn("flex items-center gap-1 text-[10px] font-medium", prodStats.pct >= 0 ? "text-[var(--flow-analyze)]" : "text-destructive")}>
                        {prodStats.pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {prodStats.pct >= 0 ? '+' : ''}{prodStats.pct}%
                      </div>
                    )}
                  </li>
                  {prodStats.previous !== null && (
                    <li className="flex items-center gap-3">
                      <div className="icon-tile w-8 h-8 rounded-full bg-[var(--flow-study-bg)]">
                        <Calendar className="w-3.5 h-3.5 text-[var(--flow-study)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{prodStats.previousLabel}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {prodStats.previous} completed
                        </p>
                      </div>
                    </li>
                  )}
                  {prodStats.extra && (
                    <li className="flex items-center gap-3">
                      <div className="icon-tile w-8 h-8 rounded-full bg-primary/10">
                        <TrendingUp className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">Overall</p>
                        <p className="text-[10px] text-muted-foreground">{prodStats.extra}</p>
                      </div>
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Trends will appear here as you complete tasks.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Smart Academy */}
          <SmartAcademyWidget />
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove &ldquo;{deleteTarget?.title}&rdquo; from your list.
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
