import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Flame, CheckSquare, Smile, Brain, LineChart, PenLine } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/common/StatCard';
import { JournalEditor } from '@/features/journal/components/JournalEditor';
import { JournalCalendar } from '@/features/journal/components/JournalCalendar';
import { useJournalEntry, useJournalMonth } from '@/features/journal/useJournal';
import { moodEmoji } from '@/features/journal/components/MoodPicker';
import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { getTodayHabitSummary } from '@/features/habits/habitMoodService';
import { useAuth } from '@/hooks/useAuth';
import { useTasks } from '@/hooks/useTasks';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const LOCALE_MAP = { en: 'en-US', de: 'de-DE', fa: 'fa-IR' } as const;

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

const MOOD_LABELS: Record<string, string> = {
  great: 'Great', good: 'Good', okay: 'Okay', bad: 'Low', terrible: 'Hard',
};

const PROMPTS: { labelKey: TranslationKey; text: string }[] = [
  { labelKey: 'journal_prompt_went_well', text: '## What went well today?\n\n' },
  { labelKey: 'journal_prompt_learned', text: '## What did I learn today?\n\n' },
  { labelKey: 'journal_prompt_gratitude', text: '## Gratitude\n\n' },
  { labelKey: 'journal_prompt_tomorrow', text: "## Tomorrow's Plan\n\n" },
];

export default function JournalPage() {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const { t, lang } = useT();
  const { user } = useAuth();
  const { tasks } = useTasks();

  // Habit summary for selected date
  const [dateHabits, setDateHabits] = useState<{ completed: number; total: number; rate: number } | null>(null);
  useEffect(() => {
    if (!user) return;
    getTodayHabitSummary(user.id, selectedDate).then(setDateHabits).catch(console.error);
  }, [user, selectedDate]);

  // Selected date's journal entry (for KPI + reflection card)
  const { data: selectedEntry } = useJournalEntry(selectedDate);
  const isToday = selectedDate === todayStr();

  // Current month entries (for streak + entries count)
  const now = useMemo(() => new Date(), []);
  const { data: monthEntries = [] } = useJournalMonth(now.getFullYear(), now.getMonth() + 1);

  // Recent entries for memory timeline (last 7 from current month)
  const recentEntries = useMemo(() => {
    return [...monthEntries]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7);
  }, [monthEntries]);

  // Streak: consecutive days with an entry (from today backwards)
  const streak = useMemo(() => {
    const dates = new Set(monthEntries.map(e => e.date));
    let count = 0;
    const d = new Date();
    for (let i = 0; i < 60; i++) {
      const key = d.toISOString().split('T')[0];
      if (dates.has(key)) { count++; d.setDate(d.getDate() - 1); }
      else if (i === 0) { d.setDate(d.getDate() - 1); }
      else break;
    }
    return count;
  }, [monthEntries]);

  // Tasks due on selected date
  const dateTasks = useMemo(() => {
    const due = tasks.filter(t2 => t2.dueDate === selectedDate);
    return { total: due.length, done: due.filter(t2 => t2.completed).length };
  }, [tasks, selectedDate]);

  // Mood trend (last 14 days from journal_entries)
  const [moodTrend, setMoodTrend] = useState<Array<{ date: string; value: number }>>([]);
  useEffect(() => {
    if (!user) return;
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
    supabase
      .from('journal_entries')
      .select('date, mood')
      .eq('user_id', user.id)
      .gte('date', fourteenDaysAgo)
      .order('date')
      .then(({ data }) => {
        const moodMap: Record<string, number> = { great: 5, good: 4, okay: 3, bad: 2, terrible: 1 };
        setMoodTrend(
          (data ?? [])
            .filter((r: { mood: string | null }) => r.mood && moodMap[r.mood])
            .map((r: { date: string; mood: string }) => ({ date: r.date.slice(5), value: moodMap[r.mood] }))
        );
      });
  }, [user]);

  // Prompt insertion handler (passed to editor via ref trick — or just append to textarea via event)
  const [promptInsert, setPromptInsert] = useState<string | null>(null);
  const handlePrompt = useCallback((text: string) => {
    setPromptInsert(text);
    // Reset after a tick so the editor can pick it up
    setTimeout(() => setPromptInsert(null), 100);
  }, []);

  const displayDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString(LOCALE_MAP[lang], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between py-5">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">
            {t('journal_title')}{selectedEntry?.mood ? ` ${moodEmoji(selectedEntry.mood)}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground">{displayDate}</p>
        </div>
        {!isToday && (
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setSelectedDate(todayStr())}>
            {t('journal_back_to_today')}
          </Button>
        )}
      </motion.div>

      {/* Main 2-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
        {/* Left column */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={Flame}
              label={t('journal_streak')}
              value={<>{streak} <span className="text-sm font-normal text-muted-foreground">days</span></>}
            />
            <StatCard icon={BookOpen} label={t('journal_entries_month')} value={monthEntries.length} />
            <StatCard
              icon={Smile}
              label={t('journal_mood')}
              value={selectedEntry?.mood ? `${moodEmoji(selectedEntry.mood)} ${MOOD_LABELS[selectedEntry.mood] ?? ''}` : '—'}
            />
            <StatCard
              icon={Brain}
              label={t('journal_ai_insight')}
              valueClassName="text-[var(--flow-analyze)]"
              value="Positive"
            />
          </div>

          {/* Date Reflection */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-2">
              <h3 className="text-sm font-semibold">
                {isToday ? t('journal_todays_reflection') : t('journal_date_reflection')}
              </h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">{t('journal_habits_status')}</p>
                  <p className="text-sm font-bold">
                    {dateHabits ? `${dateHabits.completed}/${dateHabits.total}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('journal_tasks_status')}</p>
                  <p className="text-sm font-bold">
                    {dateTasks.total > 0 ? `${dateTasks.done}/${dateTasks.total}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('journal_mood')}</p>
                  <p className="text-sm font-bold">{selectedEntry?.mood ? moodEmoji(selectedEntry.mood) : '—'}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground truncate" dir="auto">
                {selectedEntry?.content ? selectedEntry.content.slice(0, 100) + (selectedEntry.content.length > 100 ? '...' : '') : t('journal_no_entry_yet')}
              </p>
            </CardContent>
          </Card>

          {/* Journal Entry */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-3">
              {/* DESIGN-AUDIT 1: emoji heading -> icon-tile + lucide icon */}
              <div className="flex items-center gap-2.5">
                <div className="icon-tile w-7 h-7 rounded-md"><PenLine className="w-3.5 h-3.5 text-primary" /></div>
                <h3 className="text-sm font-semibold">{t('journal_entry_card')}</h3>
              </div>
              {/* Reflection prompts */}
              <div className="flex flex-wrap gap-2">
                {PROMPTS.map(p => (
                  <motion.button
                    key={p.labelKey}
                    type="button"
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handlePrompt(p.text)}
                    // DESIGN-AUDIT 1 (Journal chips): raw indigo -> flow
                    // tokens. The hover glow moved out of framer-motion
                    // (which cannot interpolate a var()) into a Tailwind
                    // arbitrary hover shadow on the same token.
                    className="rounded-full px-3.5 py-1.5 text-xs font-medium transition-all hover:shadow-[0_0_12px_var(--flow-glow-violet-soft)]"
                    style={{
                      border: '1px solid var(--flow-border-active)',
                      background: 'var(--flow-study-bg)',
                      color: 'var(--flow-primary-200)',
                    }}
                  >
                    {t(p.labelKey)}
                  </motion.button>
                ))}
              </div>
              <JournalEditor date={selectedDate} promptInsert={promptInsert} />
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="w-full lg:w-[300px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* Mini calendar */}
          <JournalCalendar selectedDate={selectedDate} onSelect={setSelectedDate} />

          {/* AI Reflection — placeholder */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="icon-tile w-7 h-7 rounded-md"><Brain className="w-3.5 h-3.5 text-primary" /></div>
                <span className="text-sm font-semibold">{t('journal_ai_reflection')}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('journal_ai_placeholder')}</p>
              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => toast(t('journal_ai_coming_soon'))}>
                <Brain className="w-3.5 h-3.5" />
                {t('journal_ai_generate')}
              </Button>

              {/* Mood trend mini chart */}
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                  <LineChart className="w-3 h-3" /> {t('journal_mood_trend')}
                </p>
                {moodTrend.length >= 2 ? (
                  <div className="h-20">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={moodTrend} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        {/* DESIGN-AUDIT 1: raw #22D3EE -> --flow-cyan */}
                        <defs>
                          <linearGradient id="moodTrendGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--flow-cyan)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="var(--flow-cyan)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="value" stroke="var(--flow-cyan)" strokeWidth={1.5} fill="url(#moodTrendGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground text-center py-4">{t('journal_no_mood_data')}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Memory Timeline */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-3">
              {/* DESIGN-AUDIT 1: emoji heading -> icon-tile + lucide icon */}
              <div className="flex items-center gap-2.5">
                <div className="icon-tile w-7 h-7 rounded-md"><BookOpen className="w-3.5 h-3.5 text-primary" /></div>
                <h3 className="text-sm font-semibold">{t('journal_memory_timeline')}</h3>
              </div>
              {recentEntries.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('journal_no_entries')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {recentEntries.map(entry => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedDate(entry.date)}
                        className={cn(
                          "w-full text-left rounded-lg px-2.5 py-2 transition-colors hover:bg-secondary/30",
                          entry.date === selectedDate && "bg-primary/10 border border-primary/20"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground shrink-0">{entry.date.slice(5)}</span>
                          {entry.mood && <span className="text-xs">{moodEmoji(entry.mood)}</span>}
                          <span className="text-xs text-muted-foreground truncate flex-1" dir="auto">
                            {(entry as { content?: string }).content
                              ? (entry as { content: string }).content.slice(0, 60)
                              : t('journal_no_content')}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
