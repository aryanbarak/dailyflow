import { useState, useEffect } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { alarmService, REMIND_OPTIONS } from '../alarmService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useT, type TranslationKey } from '@/i18n';

// I18N-SWEEP-1: REMIND_OPTIONS lives in alarmService (module scope, used
// beyond React); translate its fixed labels here by minute value.
const REMIND_LABEL_KEYS: Record<number, TranslationKey> = {
  0: 'remind_at_time',
  15: 'remind_15_minutes',
  30: 'remind_30_minutes',
  60: 'remind_1_hour',
  120: 'remind_2_hours',
  1440: 'remind_1_day',
  2880: 'remind_2_days',
};

interface AlarmPickerProps {
  sourceType: 'task' | 'calendar_event';
  sourceId: string;
  sourceTitle: string;
  eventAt: string;
  className?: string;
}

export function AlarmPicker({
  sourceType, sourceId, sourceTitle, eventAt, className,
}: Readonly<AlarmPickerProps>) {
  const { t } = useT();
  const [current, setCurrent] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const remindLabel = (minutes: number) =>
    REMIND_LABEL_KEYS[minutes]
      ? t(REMIND_LABEL_KEYS[minutes])
      : REMIND_OPTIONS.find(o => o.value === minutes)?.label ?? `${minutes}m before`;

  useEffect(() => {
    alarmService.getForSource(sourceId)
      .then(alarm => setCurrent(alarm?.remindBeforeMinutes ?? null))
      .catch(() => setCurrent(null))
      .finally(() => setIsLoading(false));
  }, [sourceId]);

  const handleChange = async (minutes: number | null) => {
    setIsSaving(true);
    try {
      if (minutes === null) {
        await alarmService.removeForSource(sourceId);
        setCurrent(null);
        toast.success(t('alarm_removed'));
      } else {
        await alarmService.setAlarm({ sourceType, sourceId, sourceTitle, eventAt, remindBeforeMinutes: minutes });
        setCurrent(minutes);
        toast.success(t('alarm_set', { label: remindLabel(minutes) }));
      }
    } catch {
      toast.error(t('alarm_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <Loader2 className="w-3 h-3 animate-spin" /> {t('loading')}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Bell className={cn('w-3.5 h-3.5 flex-shrink-0', current !== null ? 'text-cyan-400' : 'text-muted-foreground')} />
      <select
        value={current ?? ''}
        disabled={isSaving}
        onChange={e => void handleChange(e.target.value === '' ? null : Number(e.target.value))}
        className="text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 cursor-pointer"
      >
        <option value="">{t('alarm_none')}</option>
        {REMIND_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{remindLabel(opt.value)}</option>
        ))}
      </select>
      {current !== null && (
        <button
          onClick={() => void handleChange(null)}
          className="text-muted-foreground hover:text-destructive transition-colors"
          title={t('alarm_remove')}
        >
          <BellOff className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
