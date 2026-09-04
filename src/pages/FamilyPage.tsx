import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Calendar, CalendarDays, FileText, Trash2, ShoppingCart, Users, GraduationCap,
  CheckSquare, Settings, MoreVertical, Edit2, Bot, BookOpen, ArrowRight, Home, PartyPopper,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StatePanel } from '@/components/common/StatePanel';
import {
  SkeletonBlock, SkeletonCard, SkeletonListItem, SkeletonSection,
} from '@/components/common/Skeletons';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFamily } from '@/hooks/useFamily';
import { useTasks } from '@/hooks/useTasks';
import { Child, ChildScheduleItem, ChildEvent } from '@/features/family/familyService';
import { childHomeworkService, type Homework, type HomeworkCreateInput } from '@/features/family/childHomeworkService';
import { childExamsService, type Exam, type ExamCreateInput } from '@/features/family/childExamsService';
import { ShoppingList } from '@/features/shopping/ShoppingList';
import { useShoppingList } from '@/features/shopping/useShoppingList';
import {
  createCalendarEventFromFamily, deleteCalendarEventById,
} from '@/features/calendar/calendarService';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// DESIGN-AUDIT 1: member colors from the flow tokens.
const defaultColors = ['bg-[var(--flow-plan)]', 'bg-[var(--flow-review)]', 'bg-[var(--flow-analyze)]', 'bg-[var(--flow-career)]'];
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}
function todayWeekday(): string {
  const d = new Date();
  return DAYS_OF_WEEK[(d.getDay() + 6) % 7];
}

const CATEGORY_COLORS: Record<string, string> = {
  school: 'bg-[var(--flow-review-bg)] text-[var(--flow-review)]',
  health: 'bg-[var(--flow-analyze-bg)] text-[var(--flow-analyze)]',
  sports: 'bg-[var(--flow-career-bg)] text-[var(--flow-career)]',
  meeting: 'bg-[var(--flow-study-bg)] text-[var(--flow-study)]',
};

export default function FamilyPage() {
  const { children, isLoading, error, addChild, updateChild, removeChild } = useFamily();
  const { tasks } = useTasks();
  const { data: shoppingItems = [] } = useShoppingList();
  const { t } = useT();
  const navigate = useNavigate();

  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Form state
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [color, setColor] = useState(defaultColors[0]);
  const [formError, setFormError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDate, setNewEventDate] = useState('');
  const [newEventCategory, setNewEventCategory] = useState('');
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [addToCalendar, setAddToCalendar] = useState(true);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, string>>({});
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Homework state
  const [homework, setHomework] = useState<Homework[]>([]);
  const [hwSubject, setHwSubject] = useState('');
  const [hwTitle, setHwTitle] = useState('');
  const [hwDue, setHwDue] = useState('');
  const [hwPriority, setHwPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [isSavingHw, setIsSavingHw] = useState(false);

  // Exams state
  const [exams, setExams] = useState<Exam[]>([]);
  const [examSubject, setExamSubject] = useState('');
  const [examDate, setExamDate] = useState('');
  const [examNotes, setExamNotes] = useState('');
  const [isSavingExam, setIsSavingExam] = useState(false);

  // All homework for KPI
  const [allPendingHw, setAllPendingHw] = useState<Homework[]>([]);

  const hasChildren = children.length > 0;

  const selectedChild: Child | null = useMemo(() => {
    if (!hasChildren) return null;
    if (selectedChildId) return children.find(c => c.id === selectedChildId) ?? children[0];
    return children[0];
  }, [children, hasChildren, selectedChildId]);

  useEffect(() => {
    if (!hasChildren) { setSelectedChildId(null); return; }
    if (!selectedChildId || !children.some(c => c.id === selectedChildId)) {
      setSelectedChildId(children[0].id);
    }
  }, [children, hasChildren, selectedChildId]);

  // Load homework + exams for selected child
  useEffect(() => {
    if (!selectedChild) { setHomework([]); setExams([]); return; }
    childHomeworkService.getByChild(selectedChild.id).then(setHomework).catch(() => setHomework([]));
    childExamsService.getByChild(selectedChild.id).then(setExams).catch(() => setExams([]));
  }, [selectedChild?.id]);

  // Load all pending homework for KPI
  useEffect(() => {
    childHomeworkService.getAllPending().then(setAllPendingHw).catch(() => setAllPendingHw([]));
  }, [homework]);

  // Sync schedule draft
  useEffect(() => {
    if (!selectedChild) { setScheduleDraft({}); return; }
    const draft: Record<string, string> = {};
    DAYS_OF_WEEK.forEach(day => { draft[day] = ''; });
    (selectedChild.schedule ?? []).forEach(item => {
      if (item.day && typeof item.activity === 'string') draft[item.day] = item.activity;
    });
    setScheduleDraft(draft);
  }, [selectedChild]);

  // ─── KPI computations ───
  const today = todayIso();

  const totalEvents = useMemo(() =>
    children.reduce((sum, c) => sum + (c.events ?? []).filter(e => !!e.date && !!e.title).length, 0)
  , [children]);

  const todayEvents = useMemo(() => {
    const result: Array<ChildEvent & { childName: string }> = [];
    for (const child of children) {
      for (const ev of (child.events ?? [])) {
        if (ev.date === today && ev.title) result.push({ ...ev, childName: child.name });
      }
    }
    return result;
  }, [children, today]);

  const openTasks = useMemo(() =>
    tasks.filter(t2 => !t2.completed).length
  , [tasks]);

  // Upcoming events (next 30 days) across all children
  const upcomingAll = useMemo(() => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const futureIso = future.toISOString().split('T')[0];
    const result: Array<ChildEvent & { childName: string; childColor: string }> = [];
    for (const child of children) {
      for (const ev of (child.events ?? [])) {
        if (ev.date && ev.title && ev.date >= today && ev.date <= futureIso) {
          result.push({ ...ev, childName: child.name, childColor: child.color });
        }
      }
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }, [children, today]);

  // Sidebar: next 3 events + homework due in 3 days
  const sidebarEvents = upcomingAll.slice(0, 3);
  const threeDaysOut = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  }, []);
  const urgentHomework = useMemo(() =>
    allPendingHw.filter(h => h.due_date <= threeDaysOut).slice(0, 3)
  , [allPendingHw, threeDaysOut]);
  const highPriorityHw = useMemo(() =>
    allPendingHw.filter(h => h.priority === 'high' && h.due_date <= (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })())
  , [allPendingHw]);

  // Selected child overview data
  const childUpcomingEvents = useMemo(() => {
    if (!selectedChild) return [];
    return (selectedChild.events ?? [])
      .filter(e => e.date && e.title && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  }, [selectedChild, today]);

  const childRecentNotes = useMemo(() => {
    if (!selectedChild) return [];
    return (selectedChild.notes ?? []).slice(-5).reverse();
  }, [selectedChild]);

  // Unchecked shopping items for sidebar
  const uncheckedShopping = useMemo(() =>
    shoppingItems.filter(i => !i.checked).slice(0, 5)
  , [shoppingItems]);

  // Weekly family schedule (for overview fallback when no today events)
  const weeklyTimeline = useMemo(() => {
    const result: Array<{ day: string; childName: string; activity: string }> = [];
    for (const child of children) {
      for (const item of (child.schedule ?? [])) {
        if (item.day && item.activity?.trim()) {
          result.push({ day: item.day, childName: child.name, activity: item.activity });
        }
      }
    }
    return DAYS_OF_WEEK
      .map(day => ({ day, items: result.filter(r => r.day === day) }))
      .filter(g => g.items.length > 0);
  }, [children]);

  // AI assistant: build natural-language items
  const childNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of children) map.set(c.id, c.name);
    return map;
  }, [children]);

  const assistantItems = useMemo(() => {
    const items: Array<{ text: string; priority: number }> = [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowIso = tomorrow.toISOString().split('T')[0];
    const twoDaysOut = new Date();
    twoDaysOut.setDate(twoDaysOut.getDate() + 2);
    const twoDaysIso = twoDaysOut.toISOString().split('T')[0];

    for (const hw of allPendingHw) {
      const childName = childNameById.get(hw.child_id) ?? '';
      if (hw.due_date < today) {
        items.push({ text: t('family_ai_overdue', { child: childName, title: hw.title }), priority: 0 });
      } else if (hw.due_date === today) {
        items.push({ text: t('family_ai_due_today', { child: childName, title: hw.title }), priority: 1 });
      } else if (hw.due_date === tomorrowIso) {
        items.push({ text: t('family_ai_due_tomorrow', { child: childName, title: hw.title }), priority: 2 });
      }
    }

    for (const ev of upcomingAll.slice(0, 5)) {
      if (ev.date >= today && ev.date <= twoDaysIso) {
        items.push({ text: t('family_ai_event_soon', { child: ev.childName, title: ev.title, date: ev.date.slice(5) }), priority: 3 });
      }
    }

    const pendingCount = shoppingItems.filter(i => !i.checked).length;
    if (pendingCount > 0) {
      items.push({ text: t('family_ai_shopping', { count: String(pendingCount) }), priority: 4 });
    }

    return items.sort((a, b) => a.priority - b.priority).slice(0, 4);
  }, [allPendingHw, upcomingAll, shoppingItems, childNameById, today, t]);

  const handleGenerateWeeklyPlan = useCallback(() => {
    const childInfo = children.map(c => {
      const hwList = allPendingHw.filter(h => h.child_id === c.id).map(h => `${h.subject}: ${h.title} (due ${h.due_date})`);
      const evList = (c.events ?? []).filter(e => e.date && e.date >= today).slice(0, 3).map(e => `${e.title} on ${e.date}`);
      return `${c.name}${hwList.length ? ` — Homework: ${hwList.join(', ')}` : ''}${evList.length ? ` — Events: ${evList.join(', ')}` : ''}`;
    }).join('\n');
    sessionStorage.setItem('chat_initial_prompt', `Help me plan this week for my family:\n${childInfo}`);
    navigate('/chat');
  }, [children, allPendingHw, today, navigate]);

  // ─── Handlers ───
  const handleOpenNew = () => {
    setName(''); setAge(''); setColor(defaultColors[0]); setFormError(null); setIsDialogOpen(true);
  };

  const handleSaveNew = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { setFormError(t('family_name_required')); return; }
    const numericAge = age ? Number(age) : undefined;
    if (age && (Number.isNaN(numericAge) || (numericAge ?? 0) <= 0)) { setFormError(t('family_age_invalid')); return; }
    const initials = getInitials(trimmedName);
    const created = await addChild({ name: trimmedName, age: numericAge, color, initials, schedule: [], notes: [], events: [] });
    if (created) { setIsDialogOpen(false); setSelectedChildId(created.id); }
  };

  const handleAddNote = async () => {
    if (!selectedChild) return;
    const trimmed = newNote.trim();
    if (!trimmed) return;
    try { setIsSavingNote(true); await updateChild(selectedChild.id, { notes: [...(selectedChild.notes ?? []), trimmed] }); setNewNote(''); }
    finally { setIsSavingNote(false); }
  };

  const handleDeleteNote = async (index: number) => {
    if (!selectedChild) return;
    await updateChild(selectedChild.id, { notes: (selectedChild.notes ?? []).filter((_, i) => i !== index) });
  };

  const handleAddEvent = async () => {
    if (!selectedChild) return;
    const title = newEventTitle.trim();
    const date = newEventDate.trim();
    if (!title || !date) return;
    setIsSavingEvent(true);
    try {
      let calendarEventId: string | undefined;
      if (addToCalendar) {
        const result = await createCalendarEventFromFamily({ title, date, childName: selectedChild.name });
        calendarEventId = result.id;
      }
      const newEv: ChildEvent = { title, date, calendarEventId };
      await updateChild(selectedChild.id, { events: [...(selectedChild.events ?? []), newEv] });
      setNewEventTitle(''); setNewEventDate(''); setNewEventCategory('');
    } finally { setIsSavingEvent(false); }
  };

  const handleDeleteEvent = async (index: number) => {
    if (!selectedChild) return;
    const events = selectedChild.events ?? [];
    const ev = events[index];
    await updateChild(selectedChild.id, { events: events.filter((_, i) => i !== index) });
    if (ev?.calendarEventId) { deleteCalendarEventById(ev.calendarEventId).catch(console.error); }
  };

  const handleSaveSchedule = async () => {
    if (!selectedChild) return;
    const items: ChildScheduleItem[] = DAYS_OF_WEEK
      .filter(day => (scheduleDraft[day] ?? '').trim())
      .map(day => ({ day, activity: scheduleDraft[day].trim() }));
    try { setIsSavingSchedule(true); await updateChild(selectedChild.id, { schedule: items }); }
    finally { setIsSavingSchedule(false); }
  };

  const handleAddHomework = async () => {
    if (!selectedChild || !hwSubject.trim() || !hwTitle.trim() || !hwDue) return;
    setIsSavingHw(true);
    try {
      const input: HomeworkCreateInput = { child_id: selectedChild.id, subject: hwSubject.trim(), title: hwTitle.trim(), due_date: hwDue, priority: hwPriority };
      const created = await childHomeworkService.create(input);
      setHomework(prev => [...prev, created]);
      setHwSubject(''); setHwTitle(''); setHwDue(''); setHwPriority('normal');
    } finally { setIsSavingHw(false); }
  };

  const handleCompleteHomework = async (id: string) => {
    await childHomeworkService.complete(id);
    setHomework(prev => prev.map(h => h.id === id ? { ...h, completed: true, completed_at: new Date().toISOString() } : h));
  };

  const handleDeleteHomework = async (id: string) => {
    await childHomeworkService.delete(id);
    setHomework(prev => prev.filter(h => h.id !== id));
  };

  const handleAddExam = async () => {
    if (!selectedChild || !examSubject.trim() || !examDate) return;
    setIsSavingExam(true);
    try {
      const input: ExamCreateInput = { child_id: selectedChild.id, subject: examSubject.trim(), exam_date: examDate, notes: examNotes.trim() || undefined };
      const created = await childExamsService.create(input);
      setExams(prev => [...prev, created]);
      setExamSubject(''); setExamDate(''); setExamNotes('');
    } finally { setIsSavingExam(false); }
  };

  const handleDeleteExam = async (id: string) => {
    await childExamsService.delete(id);
    setExams(prev => prev.filter(e => e.id !== id));
  };

  const isInitialLoading = isLoading && !children.length;

  // Quick action handlers for sidebar
  const quickAddEvent = useCallback(() => { setActiveTab('events'); }, []);
  const quickAddHomework = useCallback(() => { setActiveTab('school'); }, []);
  const quickAddNote = useCallback(() => { setActiveTab('notes'); }, []);
  const quickAddShopping = useCallback(() => { setActiveTab('shopping'); }, []);

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6">
      {error && (
        <div className="mb-4">
          <StatePanel variant="error" title="Family failed to load" description={error || 'Failed to load family data.'} />
        </div>
      )}

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between py-5">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">{t('family_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('family_subtitle')}</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" style={{ background: 'var(--gradient-primary)' }} onClick={handleOpenNew}>
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('family_add_child')}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{t('family_add_child')}</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              {formError && <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert>}
              <div className="space-y-2">
                <Label>{t('family_child_name')}</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Emma" />
              </div>
              <div className="space-y-2">
                <Label>{t('family_age')}</Label>
                <Input type="number" min={0} value={age} onChange={e => setAge(e.target.value)} placeholder="8" />
              </div>
              <div className="space-y-2">
                <Label>{t('family_color')}</Label>
                <div className="flex gap-2">
                  {defaultColors.map(c => (
                    <button key={c} type="button" onClick={() => setColor(c)}
                      className={cn('w-7 h-7 rounded-full border-2 border-transparent', c, color === c && 'ring-2 ring-offset-2 ring-primary')} />
                  ))}
                </div>
              </div>
              <Button className="w-full" onClick={() => void handleSaveNew()}>{t('family_save')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {isInitialLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
          <div className="grid gap-4 lg:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>
        </div>
      ) : !hasChildren ? (
        <StatePanel variant="empty" title={t('family_no_children')} description={t('family_no_children_desc')} actionLabel={t('family_add_child')} onAction={handleOpenNew} />
      ) : (
        <>
          {/* Two-column layout */}
          <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
          {/* Left column */}
          <div className="flex-1 min-w-0 space-y-4">

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-[var(--flow-study-bg)]"><Users className="w-4 h-4 text-[var(--flow-study)]" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('family_children')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{children.length}</p>
                <p className="text-[11px] text-muted-foreground">{t('family_total_kids')}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-[var(--flow-review-bg)]"><Calendar className="w-4 h-4 text-[var(--flow-review)]" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('family_events')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{todayEvents.length > 0 ? todayEvents.length : totalEvents}</p>
                <p className="text-[11px] text-muted-foreground">{todayEvents.length > 0 ? t('family_events_today') : t('family_total_events')}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-[var(--flow-career-bg)]"><GraduationCap className="w-4 h-4 text-[var(--flow-career)]" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('family_homework')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{allPendingHw.length}</p>
                <p className="text-[11px] text-muted-foreground">{t('family_pending_tasks')}</p>
              </CardContent>
            </Card>
            <Card className="glass-card card-accent surface-elevated">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="icon-tile w-8 h-8 rounded-md bg-[var(--flow-analyze-bg)]"><CheckSquare className="w-4 h-4 text-[var(--flow-analyze)]" /></div>
                  <span className="text-xs font-medium text-muted-foreground">{t('family_tasks')}</span>
                </div>
                <p className="text-2xl font-bold tracking-tight">{openTasks}</p>
                <p className="text-[11px] text-muted-foreground">{t('family_open_tasks')}</p>
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Children list + Today's overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Children list */}
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t('family_children')}</h3>
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="space-y-1.5">
                  {children.map(child => {
                    const isSelected = selectedChild?.id === child.id;
                    return (
                      <motion.button
                        key={child.id}
                        type="button"
                        whileHover={{ scale: 1.01 }}
                        onClick={() => setSelectedChildId(child.id)}
                        className={cn(
                          'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                          isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-secondary/30 border border-transparent'
                        )}
                      >
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                          style={{ backgroundColor: child.color.startsWith('#') ? child.color : undefined }}
                          // For Tailwind class colors we use className fallback
                        >
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className={cn('text-xs text-white', !child.color.startsWith('#') && child.color)}
                              style={child.color.startsWith('#') ? { backgroundColor: child.color } : undefined}>
                              {child.initials}
                            </AvatarFallback>
                          </Avatar>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{child.name}</p>
                          {child.age != null && <p className="text-[11px] text-muted-foreground">{t('family_age')} {child.age}</p>}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title={t('family_options')} onClick={e => e.stopPropagation()}>
                              <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); void removeChild(child.id); }}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" /> {t('family_delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </motion.button>
                    );
                  })}
                </div>
                <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={handleOpenNew}>
                  <Plus className="w-3.5 h-3.5" /> {t('family_add_child')}
                </Button>
              </CardContent>
            </Card>

            {/* Today's overview */}
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t('family_today_overview')}</h3>
                  <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => navigate('/calendar')}>
                    <Calendar className="w-3 h-3" /> {t('family_view_calendar')}
                  </Button>
                </div>
                {todayEvents.length > 0 ? (
                  <div className="space-y-2">
                    {todayEvents.map((ev, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg bg-secondary/20 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{ev.title}</p>
                          <p className="text-[10px] text-muted-foreground">{ev.childName}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">{t('family_planned')}</Badge>
                      </div>
                    ))}
                  </div>
                ) : weeklyTimeline.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">{t('family_this_week')}</p>
                    {weeklyTimeline.map(group => (
                      <div key={group.day}>
                        <p className={cn('text-[10px] font-semibold mb-0.5', group.day === todayWeekday() ? 'text-primary' : 'text-muted-foreground')}>{group.day}</p>
                        {group.items.map((item, j) => (
                          <div key={j} className="flex items-center gap-2 ml-3 mb-0.5">
                            <span className="text-[10px] text-muted-foreground">{item.childName}:</span>
                            <span className="text-xs">{item.activity}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-3 text-center">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">{t('family_this_week')}</p>
                    <p className="text-xs text-muted-foreground">{t('family_add_schedule_hint')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Row 3: Selected child detail */}
          {selectedChild && (
            <>
              <Card className="glass-card card-accent">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className={cn('text-sm text-white', !selectedChild.color.startsWith('#') && selectedChild.color)}
                        style={selectedChild.color.startsWith('#') ? { backgroundColor: selectedChild.color } : undefined}>
                        {selectedChild.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold">{selectedChild.name}</h3>
                      {(() => {
                        const info = [
                          selectedChild.age != null ? `${t('family_age')} ${selectedChild.age}` : null,
                          selectedChild.grade ? `${t('family_grade')} ${selectedChild.grade}` : null,
                          selectedChild.school ?? null,
                        ].filter(Boolean).join('  ·  ');
                        return info ? <p className="text-xs text-muted-foreground mt-0.5">{info}</p> : null;
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-3 grid grid-cols-3 sm:grid-cols-6 w-full h-auto">
                  <TabsTrigger value="overview" className="text-xs py-1.5 gap-1"><Home className="w-3 h-3" />{t('family_tab_overview')}</TabsTrigger>
                  <TabsTrigger value="schedule" className="text-xs py-1.5 gap-1"><CalendarDays className="w-3 h-3" />{t('family_tab_schedule')}</TabsTrigger>
                  <TabsTrigger value="school" className="text-xs py-1.5 gap-1"><GraduationCap className="w-3 h-3" />{t('family_tab_school')}</TabsTrigger>
                  <TabsTrigger value="notes" className="text-xs py-1.5 gap-1"><FileText className="w-3 h-3" />{t('family_tab_notes')}</TabsTrigger>
                  <TabsTrigger value="events" className="text-xs py-1.5 gap-1"><PartyPopper className="w-3 h-3" />{t('family_tab_events')}</TabsTrigger>
                  <TabsTrigger value="shopping" className="text-xs py-1.5 gap-1"><ShoppingCart className="w-3 h-3" />{t('family_shopping')}</TabsTrigger>
                </TabsList>

                {/* Overview tab */}
                <TabsContent value="overview">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card className="glass-card card-accent">
                      <CardContent className="p-4 space-y-3">
                        <h4 className="text-sm font-semibold">{t('family_upcoming_events')}</h4>
                        {childUpcomingEvents.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('family_no_upcoming')}</p>
                        ) : (
                          <div className="space-y-2">
                            {childUpcomingEvents.map((ev, i) => (
                              <div key={i} className="flex items-center gap-3">
                                <div className="text-center shrink-0 w-10">
                                  <p className="text-[10px] font-bold text-primary uppercase">
                                    {new Date(ev.date + 'T00:00:00').toLocaleDateString('en', { month: 'short' })}
                                  </p>
                                  <p className="text-lg font-bold leading-none">{new Date(ev.date + 'T00:00:00').getDate()}</p>
                                </div>
                                <p className="text-xs flex-1 truncate">{ev.title}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    <Card className="glass-card card-accent">
                      <CardContent className="p-4 space-y-3">
                        <h4 className="text-sm font-semibold">{t('family_tab_notes')}</h4>
                        {childRecentNotes.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('family_no_notes')}</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {childRecentNotes.map((note, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                                <span className="text-primary mt-0.5">•</span>
                                <span className="flex-1" dir="auto">{note}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <Button variant="outline" size="sm" className="w-full text-xs gap-1" onClick={() => setActiveTab('notes')}>
                          <Plus className="w-3 h-3" /> {t('family_add_note')}
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {/* Schedule tab */}
                <TabsContent value="schedule">
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-4">
                      <h4 className="text-sm font-semibold">{t('family_weekly_schedule')}</h4>
                      <div className="grid grid-cols-7 gap-1.5">
                        {DAYS_OF_WEEK.map(day => {
                          const isToday = day === todayWeekday();
                          return (
                            <div key={day} className={cn('rounded-lg p-2 text-center min-h-[80px]', isToday ? 'bg-primary/10 border border-primary/20' : 'bg-secondary/20')}>
                              <p className={cn('text-[10px] font-bold uppercase mb-1', isToday ? 'text-primary' : 'text-muted-foreground')}>{day.slice(0, 3)}</p>
                              <Input
                                className="text-[10px] h-auto py-1 px-1.5 bg-transparent border-0 text-center"
                                placeholder={t('family_free')}
                                value={scheduleDraft[day] ?? ''}
                                onChange={e => setScheduleDraft(prev => ({ ...prev, [day]: e.target.value }))}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-end">
                        <Button size="sm" onClick={() => void handleSaveSchedule()} disabled={isSavingSchedule}>
                          {isSavingSchedule ? t('family_saving') : t('family_save_schedule')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* School tab */}
                <TabsContent value="school">
                  <div className="space-y-4">
                    {/* Homework */}
                    <Card className="glass-card card-accent">
                      <CardContent className="p-4 space-y-3">
                        <h4 className="text-sm font-semibold">{t('family_homework')}</h4>
                        {homework.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('family_no_homework')}</p>
                        ) : (
                          <div className="space-y-1.5">
                            {homework.map(hw => (
                              <div key={hw.id} className={cn('flex items-center gap-3 rounded-lg px-3 py-2 bg-secondary/20', hw.completed && 'opacity-50')}>
                                <Checkbox checked={hw.completed} disabled={hw.completed} onCheckedChange={() => void handleCompleteHomework(hw.id)} />
                                <div className="flex-1 min-w-0">
                                  <p className={cn('text-xs font-medium', hw.completed && 'line-through')}>{hw.subject}: {hw.title}</p>
                                  <p className="text-[10px] text-muted-foreground">{t('family_due')}: {hw.due_date}</p>
                                </div>
                                <Badge variant="outline" className={cn('text-[10px]',
                                  hw.priority === 'high' ? 'border-destructive text-destructive' :
                                  hw.priority === 'low' ? 'border-muted-foreground' : ''
                                )}>{hw.priority}</Badge>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handleDeleteHomework(hw.id)}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Add homework form */}
                        <div className="border-t border-border/40 pt-3 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <Input placeholder={t('family_subject')} value={hwSubject} onChange={e => setHwSubject(e.target.value)} className="text-xs" />
                            <Input placeholder={t('family_hw_title')} value={hwTitle} onChange={e => setHwTitle(e.target.value)} className="text-xs" />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <Input type="date" value={hwDue} onChange={e => setHwDue(e.target.value)} className="text-xs" />
                            <Select value={hwPriority} onValueChange={v => setHwPriority(v as 'low' | 'normal' | 'high')}>
                              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">{t('family_priority_low')}</SelectItem>
                                <SelectItem value="normal">{t('family_priority_normal')}</SelectItem>
                                <SelectItem value="high">{t('family_priority_high')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button size="sm" variant="outline" className="w-full text-xs gap-1" disabled={isSavingHw} onClick={() => void handleAddHomework()}>
                            <Plus className="w-3 h-3" /> {t('family_add_homework')}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Exams */}
                    <Card className="glass-card card-accent">
                      <CardContent className="p-4 space-y-3">
                        <h4 className="text-sm font-semibold">{t('family_exams')}</h4>
                        {exams.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('family_no_exams')}</p>
                        ) : (
                          <div className="space-y-1.5">
                            {exams.map(ex => (
                              <div key={ex.id} className="flex items-center gap-3 rounded-lg px-3 py-2 bg-secondary/20">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium">{ex.subject}</p>
                                  <p className="text-[10px] text-muted-foreground">{ex.exam_date}{ex.grade ? ` — ${t('family_grade')}: ${ex.grade}` : ''}</p>
                                  {ex.notes && <p className="text-[10px] text-muted-foreground truncate">{ex.notes}</p>}
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handleDeleteExam(ex.id)}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="border-t border-border/40 pt-3 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <Input placeholder={t('family_subject')} value={examSubject} onChange={e => setExamSubject(e.target.value)} className="text-xs" />
                            <Input type="date" value={examDate} onChange={e => setExamDate(e.target.value)} className="text-xs" />
                          </div>
                          <Input placeholder={t('family_exam_notes')} value={examNotes} onChange={e => setExamNotes(e.target.value)} className="text-xs" />
                          <Button size="sm" variant="outline" className="w-full text-xs gap-1" disabled={isSavingExam} onClick={() => void handleAddExam()}>
                            <Plus className="w-3 h-3" /> {t('family_add_exam')}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                {/* Notes tab */}
                <TabsContent value="notes">
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-3">
                      <h4 className="text-sm font-semibold">{t('family_tab_notes')}</h4>
                      {(selectedChild.notes ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('family_no_notes')}</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {(selectedChild.notes ?? []).map((note: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 rounded-lg bg-secondary/20 px-3 py-2">
                              <span className="flex-1 text-xs whitespace-pre-wrap" dir="auto">{note}</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => void handleDeleteNote(idx)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="space-y-2">
                        <Textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder={t('family_note_placeholder')} rows={3} className="text-xs" />
                        <Button size="sm" variant="outline" className="w-full text-xs gap-1" disabled={isSavingNote || !newNote.trim()} onClick={() => void handleAddNote()}>
                          <Plus className="w-3 h-3" /> {t('family_save_note')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Events tab */}
                <TabsContent value="events">
                  <Card className="glass-card card-accent">
                    <CardContent className="p-4 space-y-3">
                      <h4 className="text-sm font-semibold">{t('family_tab_events')}</h4>
                      {(selectedChild.events ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('family_no_events')}</p>
                      ) : (
                        <div className="space-y-1.5">
                          {(selectedChild.events ?? []).map((ev: ChildEvent, idx: number) => (
                            <div key={idx} className="flex items-center gap-3 rounded-lg bg-secondary/20 px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium">{ev.title}</p>
                                <p className="text-[10px] text-muted-foreground">{ev.date}</p>
                              </div>
                              {ev.calendarEventId && <Badge variant="outline" className="text-[10px]">{t('family_in_calendar')}</Badge>}
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handleDeleteEvent(idx)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="border-t border-border/40 pt-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Input placeholder={t('family_event_title')} value={newEventTitle} onChange={e => setNewEventTitle(e.target.value)} className="text-xs" />
                          <Input type="date" value={newEventDate} onChange={e => setNewEventDate(e.target.value)} className="text-xs" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox checked={addToCalendar} onCheckedChange={c => setAddToCalendar(!!c)} />
                          <span className="text-[10px] text-muted-foreground">{t('family_sync_calendar')}</span>
                        </div>
                        <Button size="sm" variant="outline" className="w-full text-xs gap-1" disabled={isSavingEvent || !newEventTitle.trim() || !newEventDate} onClick={() => void handleAddEvent()}>
                          <Plus className="w-3 h-3" /> {t('family_save_event')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Shopping tab */}
                <TabsContent value="shopping">
                  <Card className="glass-card card-accent">
                    <CardContent className="pt-5"><ShoppingList /></CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}

          {/* Row 4: Upcoming Family Events */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold">{t('family_upcoming_family_events')}</h3>
              {upcomingAll.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('family_no_upcoming_30')}</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {upcomingAll.slice(0, 10).map((ev, i) => (
                    <div key={i} className="shrink-0 w-[160px] rounded-lg bg-secondary/20 p-3 space-y-2">
                      <div className="text-center">
                        <p className="text-[10px] font-bold text-primary uppercase">
                          {new Date(ev.date + 'T00:00:00').toLocaleDateString('en', { month: 'short' })}
                        </p>
                        <p className="text-xl font-bold leading-none">{new Date(ev.date + 'T00:00:00').getDate()}</p>
                      </div>
                      <p className="text-xs font-medium text-center truncate">{ev.title}</p>
                      <Badge variant="outline" className="text-[10px] w-full justify-center">{ev.childName}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          </div>

          {/* Right sidebar */}
          <div className="w-full lg:w-[300px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
            {/* Flow AI Family Assistant */}
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="icon-tile w-7 h-7 rounded-md"><Bot className="w-3.5 h-3.5 text-primary" /></div>
                  <span className="text-sm font-semibold">{t('family_ai_assistant')}</span>
                </div>

                {assistantItems.length > 0 ? (
                  <ul className="space-y-2">
                    {assistantItems.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-lg bg-secondary/20 px-3 py-2">
                        <span className={cn('mt-0.5', item.priority <= 1 ? 'text-destructive' : 'text-primary')}>•</span>
                        <span className="text-xs leading-relaxed">{item.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('family_all_caught_up')}</p>
                )}

                <Button variant="outline" size="sm" className="w-full text-xs gap-1.5" onClick={handleGenerateWeeklyPlan}>
                  <CalendarDays className="w-3 h-3" /> {t('family_generate_plan')}
                </Button>
              </CardContent>
            </Card>

            {/* Shopping List preview */}
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">{t('family_shopping')}</h3>
                {uncheckedShopping.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('family_shopping_empty')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {uncheckedShopping.map(item => (
                      <li key={item.id} className="text-xs flex items-center gap-2">
                        <span className="text-muted-foreground">○</span>
                        <span>{item.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button variant="outline" size="sm" className="w-full text-xs" onClick={quickAddShopping}>
                  {t('family_view_full_list')}
                </Button>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className="glass-card card-accent">
              <CardContent className="p-4 space-y-2">
                <h3 className="text-sm font-semibold mb-1">{t('family_quick_actions')}</h3>
                <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={quickAddEvent}>
                  <Plus className="w-3.5 h-3.5 text-[var(--flow-review)]" /> {t('family_add_event')}
                </Button>
                <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={quickAddHomework}>
                  <Plus className="w-3.5 h-3.5 text-[var(--flow-career)]" /> {t('family_add_homework')}
                </Button>
                <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={quickAddNote}>
                  <Plus className="w-3.5 h-3.5 text-[var(--flow-analyze)]" /> {t('family_add_note')}
                </Button>
                <Button size="sm" variant="outline" className="w-full justify-start gap-2 text-xs" onClick={quickAddShopping}>
                  <ShoppingCart className="w-3.5 h-3.5 text-[var(--flow-study)]" /> {t('family_add_to_shopping')}
                </Button>
              </CardContent>
            </Card>
          </div>
          </div>
        </>
      )}
    </div>
  );
}
