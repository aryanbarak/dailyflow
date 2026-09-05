import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Flame, Trophy, Calendar, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAllHabits, useToggleHabit } from '@/features/habits/useHabits';
import { habitsService } from '@/features/habits/habitsService';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const ICONS = ['⭐', '💪', '📚', '🏃', '🧘', '🧠', '🎯', '🌱', '😴', '🎵'];
// DESIGN-AUDIT 1: the pickable habit palette now comes from the flow
// token palette (flow-tokens.css: primary/plan/career/analyze/blue/study/
// cyan/review) instead of 8 arbitrary Tailwind hexes. Stored habits keep
// whatever hex they already saved -- this only changes what NEW picks offer.
const COLORS = ['#7C4DFF', '#F06AC6', '#F3A044', '#55E38A', '#4F73FF', '#9B5CFF', '#62DDF4', '#5F91FF'];

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDate().toString();
}

export default function HabitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useT();
  const { data: allHabits = [], isLoading } = useAllHabits();
  const { mutate: toggle } = useToggleHabit();

  const habit = allHabits.find(h => h.id === id);

  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editColor, setEditColor] = useState('');

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const completionSet = useMemo(
    () => new Set(habit?.completions.map(c => c.completed_date) ?? []),
    [habit?.completions],
  );

  // 30-day grid: 6 rows × 7 columns (most recent 42 days, trimmed to 30)
  const heatmapDays = useMemo(() => {
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }, []);

  // Group into weeks for the grid (5 rows of ~6 days + partial)
  const heatmapWeeks = useMemo(() => {
    const weeks: string[][] = [];
    for (let i = 0; i < heatmapDays.length; i += 7) {
      weeks.push(heatmapDays.slice(i, i + 7));
    }
    return weeks;
  }, [heatmapDays]);

  const handleStartEdit = () => {
    if (!habit) return;
    setEditTitle(habit.title);
    setEditDesc(habit.description ?? '');
    setEditIcon(habit.icon);
    setEditColor(habit.color);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!habit || !editTitle.trim()) return;
    await habitsService.update(habit.id, {
      title: editTitle.trim(),
      description: editDesc.trim() || undefined,
      icon: editIcon,
      color: editColor,
    });
    setEditing(false);
    void queryClient.invalidateQueries({ queryKey: ['habits'], exact: false });
  };

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <div className="text-center text-muted-foreground py-20 text-sm">Loading...</div>
      </div>
    );
  }

  if (!habit) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6">
        <Button variant="ghost" size="sm" className="gap-1.5 mb-4" onClick={() => navigate('/habits')}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <div className="text-center text-muted-foreground py-20 text-sm">Habit not found.</div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 py-5">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/habits')}>
          <ArrowLeft className="w-4 h-4" /> Habits
        </Button>
      </div>

      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
        {/* Habit header card */}
        <Card className="glass-card card-accent surface-elevated">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                  style={{ backgroundColor: habit.color + '22', border: `2px solid ${habit.color}55` }}
                >
                  {habit.icon}
                </div>
                <div>
                  <h1 className="text-xl font-semibold">{habit.title}</h1>
                  {habit.description && (
                    <p className="text-sm text-muted-foreground mt-0.5">{habit.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {habit.habit_type === 'goal'
                      ? t('habits_goal_line', { value: habit.target_value ?? '?', unit: habit.target_unit ?? 'target' })
                      : habit.frequency === 'daily' ? t('habits_every_day') : t('habits_weekly_line', { count: habit.target_days ?? 0 })}
                    {!habit.is_active && <span className="ms-2 text-[var(--flow-career)]">{t('habits_paused')}</span>}
                    {habit.achieved_at && <span className="ms-2 text-[var(--flow-analyze)]">{t('habits_achieved_suffix')}</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleStartEdit}>
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Button>
                <button
                  type="button"
                  aria-label={habit.completedToday ? 'Mark incomplete' : 'Mark complete'}
                  onClick={() => toggle({ habitId: habit.id })}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor: habit.completedToday ? habit.color : 'transparent',
                    border: `2px solid ${habit.color}`,
                    color: habit.completedToday ? 'white' : habit.color,
                  }}
                >
                  <Check size={18} />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="glass-card card-accent">
            <CardContent className="p-3.5 text-center">
              <div className="icon-tile w-8 h-8 rounded-md mx-auto mb-2">
                <Flame className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold">{habit.currentStreak}</p>
              <p className="text-[10px] text-muted-foreground">{t('habits_current_streak')}</p>
            </CardContent>
          </Card>
          <Card className="glass-card card-accent">
            <CardContent className="p-3.5 text-center">
              <div className="icon-tile w-8 h-8 rounded-md mx-auto mb-2">
                <Trophy className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold">{habit.longestStreak}</p>
              <p className="text-[10px] text-muted-foreground">{t('habits_best_streak')}</p>
            </CardContent>
          </Card>
          <Card className="glass-card card-accent">
            <CardContent className="p-3.5 text-center">
              <div className="icon-tile w-8 h-8 rounded-md mx-auto mb-2">
                <Calendar className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold">{habit.completionRate}%</p>
              <p className="text-[10px] text-muted-foreground">{t('habits_completion_rate')}</p>
            </CardContent>
          </Card>
        </div>

        {/* Goal progress — only for goal-type habits */}
        {habit.habit_type === 'goal' && habit.target_value && (
          <Card className="glass-card card-accent surface-elevated">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">{t('habits_goal_progress')}</h3>
                {habit.achieved_at && (
                  <span className="text-xs font-medium text-[var(--flow-analyze)]">{t('habits_achieved')}</span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                    <span>{habit.completions.length} / {habit.target_value} {habit.target_unit ?? ''}</span>
                    <span>{Math.min(100, Math.round((habit.completions.length / habit.target_value) * 100))}%</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((habit.completions.length / habit.target_value) * 100))}%`,
                        backgroundColor: habit.color,
                      }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 30-day heatmap */}
        <Card className="glass-card card-accent">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Last 30 Days</h3>
            <div className="space-y-1.5">
              {heatmapWeeks.map((week, wi) => (
                <div key={wi} className="flex gap-1.5">
                  {week.map(date => {
                    const done = completionSet.has(date);
                    const isToday = date === todayStr;
                    const isFuture = date > todayStr;
                    return (
                      <div
                        key={date}
                        title={`${date}${done ? ' ✓' : ''}`}
                        className="flex-1 h-8 rounded-md flex flex-col items-center justify-center gap-0.5 transition-all"
                        style={{
                          backgroundColor: done ? habit.color : isFuture ? 'transparent' : habit.color + '10',
                          border: isToday ? `2px solid ${habit.color}` : '2px solid transparent',
                          opacity: isFuture ? 0.2 : 1,
                        }}
                      >
                        <span className={cn(
                          "text-[9px] leading-none",
                          done ? "text-white" : "text-muted-foreground"
                        )}>
                          {getDayLabel(date)}
                        </span>
                        {done && <Check size={8} color="white" />}
                      </div>
                    );
                  })}
                  {/* Pad short last row */}
                  {week.length < 7 && Array.from({ length: 7 - week.length }).map((_, pi) => (
                    <div key={`pad-${pi}`} className="flex-1" />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: habit.color }} />
                <span>Completed</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: habit.color + '10' }} />
                <span>Missed</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit form */}
        {editing && (
          <Card className="glass-card card-accent">
            <CardContent className="p-4 space-y-4">
              <h3 className="text-sm font-semibold">Edit Habit</h3>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Icon</Label>
                <div className="flex gap-2 flex-wrap">
                  {ICONS.map(i => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Select icon ${i}`}
                      onClick={() => setEditIcon(i)}
                      className="w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all"
                      style={{
                        background: editIcon === i ? editColor + '33' : 'transparent',
                        border: `1.5px solid ${editIcon === i ? editColor : 'transparent'}`,
                      }}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-2">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Select color ${c}`}
                      onClick={() => setEditColor(c)}
                      className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        outline: editColor === c ? `2px solid ${c}` : 'none',
                        outlineOffset: '2px',
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveEdit} disabled={!editTitle.trim()}>Save</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
