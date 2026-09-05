import { useEffect, useState } from 'react';
import { Plus, Flame, Bell, Check, CheckCircle2, Calendar, Trophy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAllHabits, useToggleHabit, useDeleteHabit } from '@/features/habits/useHabits';
import { cn } from '@/lib/utils';
import { HabitCard } from '@/features/habits/components/HabitCard';
import { AddHabitModal } from '@/features/habits/components/AddHabitModal';
import { useNotifications } from '@/hooks/useNotifications';
import { useT } from '@/i18n';
import { getThisWeekMoodSummary } from '@/features/habits/habitMoodService';
import { useAuth } from '@/hooks/useAuth';
import { StatCard } from '@/components/common/StatCard';
import { AiSuggestionsCard } from '@/components/common/AiSuggestionsCard';
import { useAiSuggestions } from '@/features/ai/useAiSuggestions';

export default function HabitsPage() {
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const { user } = useAuth();
  const [weekMood, setWeekMood] = useState<{ avgMood: number; entries: number; emoji: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    getThisWeekMoodSummary(user.id).then(setWeekMood).catch(console.error);
  }, [user]);
  const [habitFilter, setHabitFilter] = useState<'all' | 'active' | 'paused'>('active');
  const { data: allHabits = [], isLoading } = useAllHabits();
  const habits = allHabits.filter(h => {
    if (habitFilter === 'active') return h.is_active;
    if (habitFilter === 'paused') return !h.is_active;
    return true;
  });
  const activeHabits = allHabits.filter(h => h.is_active);
  const { mutate: toggle } = useToggleHabit();
  const { mutate: remove } = useDeleteHabit();
  const { permission, isSupported, request: requestNotifications } = useNotifications();
  const { t } = useT();

  const todayDone = activeHabits.filter(h => h.completedToday).length;
  const avgRate = activeHabits.length > 0 ? Math.round(activeHabits.reduce((s, h) => s + h.completionRate, 0) / activeHabits.length) : 0;
  const bestCurrentStreak = activeHabits.reduce((max, h) => Math.max(max, h.currentStreak), 0);
  const bestEverStreak = allHabits.reduce((max, h) => Math.max(max, h.longestStreak), 0);
  const progressPct = activeHabits.length > 0 ? Math.round((todayDone / activeHabits.length) * 100) : 0;

  // AI Suggestions — fetched from Gemini via worker (DESIGN-AUDIT phase 4:
  // shared hook, was an inline copy of the same fetch)
  const { suggestions: habitSuggestions, isLoading: suggestionsLoading } = useAiSuggestions({
    endpoint: 'habits',
    enabled: allHabits.length > 0 && !isLoading,
  });

  function renderBody() {
    if (isLoading) {
      return <div className="text-center text-muted-foreground py-12 text-sm">{t('loading')}</div>;
    }
    if (habits.length === 0) {
      return (
        <div className="text-center text-muted-foreground py-16">
          <Flame size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">{t('habits_no_habits')}</p>
          <button type="button" onClick={() => setShowAdd(true)} className="mt-3 text-primary text-sm hover:underline">
            {t('habits_add')}
          </button>
        </div>
      );
    }
    return (
      <div className="grid gap-3">
        {habits.map(habit => (
          <HabitCard
            key={habit.id}
            habit={habit}
            onToggle={id => toggle({ habitId: id })}
            onDelete={id => remove(id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between py-5"
      >
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold mb-1">{t('habits_title')}</h1>
          <p className="text-sm text-muted-foreground">{t('habits_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {isSupported && permission !== 'granted' && (
            <Button
              variant="outline"
              size="sm"
              onClick={requestNotifications}
              title="Enable daily reminder"
            >
              <Bell className="w-4 h-4" />
            </Button>
          )}
          <Button className="gap-2" style={{ background: 'var(--gradient-primary)' }} onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" />
            {t('habits_add')}
          </Button>
        </div>
      </motion.div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
        {/* Left column */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* KPI Stats Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              icon={Flame}
              label={t('habits_current_streak')}
              value={<>{bestCurrentStreak} <span className="text-sm font-normal text-muted-foreground">{t('habits_days_unit')}</span></>}
            />
            <StatCard icon={CheckCircle2} label={t('habits_completion_rate')} value={`${avgRate}%`} />
            <StatCard
              icon={Calendar}
              label={t('habits_today_label')}
              value={<>{todayDone} <span className="text-sm font-normal text-muted-foreground">/ {activeHabits.length}</span></>}
            />
            <StatCard
              icon={Trophy}
              label={t('habits_best_streak')}
              value={<>{bestEverStreak} <span className="text-sm font-normal text-muted-foreground">{t('habits_days_unit')}</span></>}
            />
          </div>

          {/* Progress bar */}
          {activeHabits.length > 0 && (
            <Card className="glass-card card-accent">
              <CardContent className="p-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-2">
                  <span>{t('today')}</span>
                  <span>{todayDone}/{activeHabits.length} · {progressPct}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    // DESIGN-AUDIT 1: primary->orange Tailwind gradient
                    // replaced by the canonical flow gradient token.
                    className="h-full rounded-full"
                    style={{ background: 'var(--flow-gradient-primary)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Today's Habits — horizontal cards */}
          {activeHabits.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t('habits_todays_habits')}</h3>
                <span className="text-xs text-muted-foreground">{t('habits_completed_line', { done: todayDone, total: activeHabits.length, pct: progressPct })}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {activeHabits.map(habit => (
                  <button
                    key={habit.id}
                    type="button"
                    onClick={() => toggle({ habitId: habit.id })}
                    className="glass-card rounded-xl p-3 text-left transition-all hover:scale-[1.02] hover:shadow-elevated"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                          style={{ backgroundColor: habit.color + '22', border: `1.5px solid ${habit.color}44` }}
                        >
                          {habit.icon}
                        </div>
                        <span className="text-xs font-medium truncate">{habit.title}</span>
                      </div>
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: habit.completedToday ? habit.color : 'transparent',
                          border: `1.5px solid ${habit.color}`,
                        }}
                      >
                        {habit.completedToday && <Check size={12} color="white" />}
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: habit.completedToday ? '100%' : '0%',
                          backgroundColor: habit.color,
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mood summary */}
          {weekMood && weekMood.entries > 0 && (
            <Card className="glass-card card-accent">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="text-3xl">{weekMood.emoji}</div>
                <div>
                  <p className="text-sm font-medium">{t('habits_mood_this_week')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Avg. {weekMood.avgMood.toFixed(1)}/5 · {weekMood.entries} {weekMood.entries === 1 ? 'entry' : 'entries'}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-2xl font-semibold">{weekMood.avgMood.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">/ 5</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filter tabs */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { value: 'all' as const, label: t('all'), count: allHabits.length },
              { value: 'active' as const, label: t('habits_active_chip'), count: allHabits.filter(h => h.is_active).length },
              { value: 'paused' as const, label: t('habits_paused_chip'), count: allHabits.filter(h => !h.is_active).length },
            ]).map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => setHabitFilter(f.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  habitFilter === f.value
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "glass-card hover:bg-secondary/40"
                )}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>

          {/* Habit list */}
          {renderBody()}
        </div>

        {/* Right sidebar */}
        <div className="w-full lg:w-[300px] shrink-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* Today's Progress */}
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="icon-tile w-7 h-7 rounded-md">
                  <Flame className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="text-sm font-semibold">{t('habits_todays_progress')}</span>
              </div>

              {/* Progress ring */}
              <div className="flex flex-col items-center">
                <div className="relative w-28 h-28">
                  <svg viewBox="0 0 112 112" className="w-full h-full -rotate-90">
                    <circle cx="56" cy="56" r="48" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                    <circle
                      cx="56" cy="56" r="48" fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${activeHabits.length > 0 ? (todayDone / activeHabits.length) * 301.6 : 0} 301.6`}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold">
                    {progressPct}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {progressPct === 100
                    ? t('habits_all_done')
                    : progressPct > 0
                      ? t('habits_great_start')
                      : t('habits_lets_go')}
                </p>
              </div>

              {/* Mini stats */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-[var(--flow-analyze)]">{todayDone}</p>
                  <p className="text-[10px] text-muted-foreground">{t('habits_completed')}</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-[var(--flow-career)]">{activeHabits.length - todayDone}</p>
                  <p className="text-[10px] text-muted-foreground">{t('habits_remaining')}</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-primary">{activeHabits.length}</p>
                  <p className="text-[10px] text-muted-foreground">{t('habits_total')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Suggestions — Gemini-generated (DESIGN-AUDIT phase 4: shared
              card; chip colors unified on the flow tokens, rows text-start) */}
          {(suggestionsLoading || habitSuggestions.length > 0) && (
            <AiSuggestionsCard
              title={t('ai_suggestions')}
              subtitle={t('ai_based_on_habits')}
              isLoading={suggestionsLoading}
              rows={habitSuggestions.map(s => ({
                text: s.text,
                kind: s.type === 'recommendation' ? 'action' as const : 'idea' as const,
                onClick: s.type === 'recommendation'
                  ? () => navigate('/chat', { state: { initialPrompt: s.text } })
                  : undefined,
              }))}
            />
          )}
        </div>
      </div>

      {showAdd && <AddHabitModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
