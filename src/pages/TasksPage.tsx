import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconTile } from "@/components/common/IconTile";
import { useNavigate } from "react-router-dom";
import { AlarmPicker } from "@/features/calendar/components/AlarmPicker";
import { motion } from "framer-motion";
import { Plus, Calendar, Trash2, Pencil, CheckSquare, ListTodo, CalendarClock, TrendingUp, TrendingDown, Target, BarChart3, MessageSquare, Send, ExternalLink } from "lucide-react";
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
import { StatCard } from "@/components/common/StatCard";
import { CollapsibleRail } from "@/components/common/CollapsibleRail";
import { AiSuggestionsCard } from "@/components/common/AiSuggestionsCard";
import { useAiSuggestions } from "@/features/ai/useAiSuggestions";
import { SchedulePicker } from "@/features/scheduling/components/SchedulePicker";
import { nextOccurrenceAfter } from "@/features/scheduling/occurrences";
import { formatDateLabel, isBeforeDay, isSameDay, toDateOnly } from "@/lib/date";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { useT, type TranslationKey } from "@/i18n";
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
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);
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

  // AI Suggestions — fetched from Gemini via worker (DESIGN-AUDIT phase 4:
  // shared hook, was an inline copy of the same fetch)
  const { suggestions: aiSuggestions, isLoading: suggestionsLoading } = useAiSuggestions({
    endpoint: 'tasks',
    enabled: tasks.length > 0 && !isLoading,
  });
  const workerUrl = import.meta.env.VITE_AGENT_WORKER_URL as string;

  // Task chat — compact ask-and-answer
  const navigate = useNavigate();
  const { createSession } = useChatSessions();
  const [taskQuestion, setTaskQuestion] = useState('');
  const [taskAnswer, setTaskAnswer] = useState<string | null>(null);
  const [taskAnswerLanguage, setTaskAnswerLanguage] = useState<SupportedAiResponseLanguage | null>(null);
  const [taskChatSessionId, setTaskChatSessionId] = useState<string | null>(null);
  const [taskChatSending, setTaskChatSending] = useState(false);

  // I18N-SWEEP-2: deliberately NOT translated -- this is model context
  // (like the [Task context] header and the "Tasks:" session title), not
  // user-visible UI; the response language is governed separately by
  // responseLanguage.ts.
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

    // I18N-SWEEP-2: the memo returns translation KEYS (not display
    // strings) so the rendered labels re-resolve on language switch
    // without `t` in the dependency array.
    if (statsRange === 'all') {
      const total = tasks.filter(t => t.completed).length;
      return {
        current: total,
        currentLabelKey: 'tasks_stats_total_completed' as TranslationKey,
        previous: null as number | null,
        previousLabelKey: null as TranslationKey | null,
        pct: null as number | null,
        hasData: total > 0,
        extraRate: counts.rate as number | null,
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
        currentLabelKey: 'tasks_stats_this_month' as TranslationKey,
        previous: prevCount as number | null,
        previousLabelKey: 'tasks_stats_last_month' as TranslationKey | null,
        pct,
        hasData,
        extraRate: null as number | null,
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
      currentLabelKey: 'tasks_stats_this_week' as TranslationKey,
      previous: prevCount as number | null,
      previousLabelKey: 'tasks_stats_last_week' as TranslationKey | null,
      pct,
      hasData,
      extraRate: null as number | null,
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
    setRecurrenceRule(null);
    setRecurrenceEndDate(null);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setDueDate(task.dueDate ?? "");
    // CORE-W5 fix: restore the task's actual schedule instead of always
    // resetting to none -- editing a recurring task used to silently
    // discard its rule.
    setRecurrenceRule(task.recurrenceRule ?? null);
    setRecurrenceEndDate(task.recurrenceEndDate ?? null);
    setFormError(null);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setFormError(t('tasks_form_title_required'));
      return;
    }
    if (editingTask) {
      // CORE-W5 fix: the schedule is now forwarded on edit too -- it used
      // to only ever be settable at creation time.
      await updateTask(editingTask.id, {
        title: trimmed,
        notes,
        dueDate: dueDate || null,
        recurrenceRule,
        recurrenceEndDate,
      });
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
    if (!task.dueDate) return t('tasks_no_due_date');
    const date = parseDateOnly(task.dueDate);
    if (isSameDay(date, today)) return t('tasks_due_today');
    if (!task.completed && isBeforeDay(date, today)) return t('tasks_overdue');
    return t('tasks_due_on', { date: formatDateLabel(task.dueDate) });
  };

  // CORE-W5 (CORE audit item 1-4): a real, storable RRULE finally means
  // this can be shown -- but purely as information. There is no
  // materialization of future rows and no completion-cascade behavior:
  // SmartFlow tasks are a manual checklist, not an agent-fired job queue
  // (unlike CORE's own tasks), so "next occurrence" is read-only here.
  const repeatsLabel = (task: Task): string | null => {
    if (!task.recurrenceRule) return null;
    const dtstart = task.dueDate ? parseDateOnly(task.dueDate) : new Date(task.createdAt);
    const until = task.recurrenceEndDate ? parseDateOnly(task.recurrenceEndDate) : null;
    const next = nextOccurrenceAfter(task.recurrenceRule, dtstart, today, until);
    return next ? t('schedule_repeats_next', { date: formatDateLabel(next.toISOString()) }) : null;
  };

  const FILTERS: { value: TaskFilter; labelKey: TranslationKey; count: number }[] = [
    { value: "all", labelKey: 'tasks_filter_all', count: tasks.length },
    { value: "today", labelKey: 'tasks_filter_today', count: counts.todayCount },
    { value: "upcoming", labelKey: 'tasks_filter_upcoming', count: counts.upcomingCount },
    { value: "overdue", labelKey: 'tasks_overdue', count: counts.overdueCount },
    { value: "completed", labelKey: 'tasks_completed', count: counts.completedCount },
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
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">{t('tasks_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('tasks_subtitle')}</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" style={{ background: 'var(--gradient-primary)' }} onClick={openNewTask}>
              <Plus className="w-4 h-4" />
              {t('tasks_add')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingTask ? t('tasks_edit') : t('tasks_new')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>{t('tasks_form_title_label')}</Label>
                <Input
                  placeholder={t('tasks_form_title_placeholder')}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('notes')}</Label>
                <Textarea
                  placeholder={t('tasks_form_notes_placeholder')}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('tasks_due_date')}</Label>
                <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </div>
              <SchedulePicker
                granularity="date"
                recurrenceRule={recurrenceRule}
                recurrenceEndDate={recurrenceEndDate}
                onChange={(result) => {
                  setRecurrenceRule(result.recurrenceRule);
                  setRecurrenceEndDate(result.recurrenceEndDate);
                  // Tasks only have a date, no time-of-day -- a one-time
                  // quick-pick/parse result just sets the due date.
                  if (result.resolvedDateTime) setDueDate(result.resolvedDateTime.slice(0, 10));
                }}
              />
              <Button className="w-full" onClick={handleSave}>
                {editingTask ? t('tasks_save_changes') : t('tasks_create')}
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
            <StatCard icon={ListTodo} label={t('tasks_stat_total')} value={tasks.length} />
            <StatCard icon={CheckSquare} label={t('tasks_stat_open')} value={counts.open} />
            <StatCard icon={CalendarClock} label={t('tasks_stat_due_week')} value={counts.upcomingCount + counts.todayCount} />
            <StatCard icon={TrendingUp} label={t('tasks_stat_completion')} value={`${counts.rate}%`} />
          </div>

          {/* Today's Focus — horizontal card */}
          {focusTotal > 0 && (
            <Card className="glass-card card-accent">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Left — icon + title */}
                  <div className="flex items-center gap-3 shrink-0">
                    <IconTile className="w-10 h-10 rounded-lg"><Target className="w-5 h-5" /></IconTile>
                    <div>
                      <p className="text-sm font-semibold">{t('tasks_focus_title')}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t('tasks_focus_subtitle')}
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
                    <p className="text-[10px] text-muted-foreground mt-1">{t('tasks_completed')}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {error && (
            <StatePanel
              variant="error"
              title={t('tasks_error_load')}
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
                {t(f.labelKey)} ({f.count})
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
                      {repeatsLabel(task) && (
                        <span className="text-[11px] text-muted-foreground">{repeatsLabel(task)}</span>
                      )}
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
                    {task.completed ? t('tasks_status_done') : t('tasks_open')}
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
                  title={t('tasks_empty_view_title')}
                  description={t('tasks_empty_view_desc')}
                  actionLabel={t('tasks_add')}
                  onAction={openNewTask}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <CollapsibleRail>
          {/* AI Suggestions — Gemini-generated (DESIGN-AUDIT phase 4: shared card, title/subtitle now translated) */}
          {(suggestionsLoading || aiSuggestions.length > 0) && (
            <AiSuggestionsCard
              title={t('ai_suggestions')}
              subtitle={t('ai_based_on_tasks')}
              isLoading={suggestionsLoading}
              rows={aiSuggestions.map(s => ({
                text: s.text,
                kind: s.type === 'recommendation' ? 'action' as const : 'idea' as const,
              }))}
            />
          )}

          {/* Ask about tasks — compact chat */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <IconTile className="w-7 h-7 rounded-md"><MessageSquare className="w-3.5 h-3.5" /></IconTile>
                <span className="text-sm font-semibold">{t('tasks_ask_title')}</span>
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
                  {t('tasks_ask_continue')}
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              )}
              <div className="flex gap-2 items-end">
                <Input
                  value={taskQuestion}
                  onChange={e => setTaskQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAskAboutTasks(); } }}
                  placeholder={t('tasks_ask_placeholder')}
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
                  <IconTile className="w-7 h-7 rounded-md"><BarChart3 className="w-3.5 h-3.5" /></IconTile>
                  <span className="text-sm font-semibold">{t('tasks_stats_title')}</span>
                </div>
                <Select value={statsRange} onValueChange={v => setStatsRange(v as 'week' | 'month' | 'all')}>
                  <SelectTrigger className="h-7 w-[110px] text-[11px] glass-card border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week" className="text-xs">{t('tasks_stats_this_week')}</SelectItem>
                    <SelectItem value="month" className="text-xs">{t('tasks_stats_this_month')}</SelectItem>
                    <SelectItem value="all" className="text-xs">{t('tasks_stats_all_time')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {prodStats.hasData ? (
                <ul className="space-y-3">
                  <li className="flex items-center gap-3">
                    <IconTile tone="analyze" className="w-8 h-8 rounded-full"><CheckSquare className="w-3.5 h-3.5" /></IconTile>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{t(prodStats.currentLabelKey)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {t('tasks_stats_completed_count', { count: prodStats.current })}
                      </p>
                    </div>
                    {prodStats.pct !== null && (
                      <div className={cn("flex items-center gap-1 text-[10px] font-medium", prodStats.pct >= 0 ? "text-[var(--flow-analyze)]" : "text-destructive")}>
                        {prodStats.pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {prodStats.pct >= 0 ? '+' : ''}{prodStats.pct}%
                      </div>
                    )}
                  </li>
                  {prodStats.previous !== null && prodStats.previousLabelKey && (
                    <li className="flex items-center gap-3">
                      <IconTile tone="study" className="w-8 h-8 rounded-full"><Calendar className="w-3.5 h-3.5" /></IconTile>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{t(prodStats.previousLabelKey)}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {t('tasks_stats_completed_count', { count: prodStats.previous })}
                        </p>
                      </div>
                    </li>
                  )}
                  {prodStats.extraRate !== null && (
                    <li className="flex items-center gap-3">
                      <IconTile className="w-8 h-8 rounded-full"><TrendingUp className="w-3.5 h-3.5" /></IconTile>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{t('tasks_stats_overall')}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {t('tasks_stats_completion_rate', { rate: prodStats.extraRate })}
                        </p>
                      </div>
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('tasks_stats_empty')}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Smart Academy */}
          <SmartAcademyWidget />
        </CollapsibleRail>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('tasks_delete_confirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('tasks_delete_desc', { title: deleteTarget?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
