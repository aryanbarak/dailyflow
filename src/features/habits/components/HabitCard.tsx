import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame, Trophy, Check, Trash2 } from 'lucide-react';
import type { HabitWithStats } from '../types';
import { localeFor, useT } from '@/i18n';

function getCurrentWeekDays(): string[] {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + mondayOffset + i);
    return d.toISOString().split('T')[0];
  });
}

interface Props {
  readonly habit: HabitWithStats;
  readonly onToggle: (id: string) => void;
  readonly onDelete: (id: string) => void;
}

export function HabitCard({ habit, onToggle, onDelete }: Props) {
  const navigate = useNavigate();
  const { t, lang } = useT();
  const weekDays = useMemo(() => getCurrentWeekDays(), []);
  // I18N-SWEEP-1: localized one-letter weekday labels for the heatmap
  // (previously a hardcoded English M/T/W/T/F/S/S array).
  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(localeFor(lang), { weekday: 'narrow' });
    return weekDays.map(date => formatter.format(new Date(`${date}T00:00:00`)));
  }, [weekDays, lang]);
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const completionSet = useMemo(
    () => new Set(habit.completions.map(c => c.completed_date)),
    [habit.completions],
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between">
        <button
          type="button"
          onClick={() => navigate(`/habits/${habit.id}`)}
          className="flex items-center gap-3 text-start hover:opacity-80 transition-opacity"
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ backgroundColor: habit.color + '22', border: `1.5px solid ${habit.color}44` }}
          >
            {habit.icon}
          </div>
          <div>
            <h3 className="font-semibold text-sm leading-tight">{habit.title}</h3>
            {habit.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{habit.description}</p>
            )}
          </div>
        </button>
        <div className="flex gap-1 flex-shrink-0">
          <button
            type="button"
            aria-label={habit.completedToday ? 'Mark incomplete' : 'Mark complete'}
            onClick={() => onToggle(habit.id)}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{
              backgroundColor: habit.completedToday ? habit.color : 'transparent',
              border: `1.5px solid ${habit.color}`,
              color: habit.completedToday ? 'white' : habit.color,
            }}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            aria-label="Delete habit"
            onClick={() => onDelete(habit.id)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent hover:border-destructive/20"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Weekly heatmap — Mon to Sun */}
      <div className="flex gap-1.5 items-end">
        {weekDays.map((date, i) => {
          const done = completionSet.has(date);
          const isFuture = date > todayStr;
          const isToday = date === todayStr;
          return (
            <div key={date} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] text-muted-foreground leading-none">{weekdayLabels[i]}</span>
              <div
                className="w-full h-6 rounded-md flex items-center justify-center transition-all"
                style={{
                  backgroundColor: done ? habit.color : isFuture ? 'transparent' : habit.color + '15',
                  border: isToday ? `1.5px solid ${habit.color}` : '1.5px solid transparent',
                  opacity: isFuture ? 0.3 : 1,
                }}
              >
                {done && <Check size={10} color="white" />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Flame size={12} style={{ color: habit.color }} />
          <span>{t('habits_streak_line', { count: habit.currentStreak })}</span>
        </span>
        <span className="flex items-center gap-1">
          <Trophy size={12} style={{ color: habit.color }} />
          <span>{t('habits_best_line', { count: habit.longestStreak })}</span>
        </span>
        <span className="ms-auto">{t('habits_month_line', { pct: habit.completionRate })}</span>
      </div>
    </motion.div>
  );
}
