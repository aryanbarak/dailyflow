import { supabase } from '@/integrations/supabase/client';

export type AlarmSourceType = 'task' | 'calendar_event';

export const REMIND_OPTIONS = [
  { label: 'At time of event', value: 0 },
  { label: '15 minutes before', value: 15 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '2 hours before', value: 120 },
  { label: '1 day before', value: 1440 },
  { label: '2 days before', value: 2880 },
];

export interface Alarm {
  id: string;
  sourceType: AlarmSourceType;
  sourceId: string;
  sourceTitle: string;
  triggerAt: string;
  remindBeforeMinutes: number;
  isFired: boolean;
  isDismissed: boolean;
}

function mapRow(row: Record<string, unknown>): Alarm {
  return {
    id: row.id as string,
    sourceType: row.source_type as AlarmSourceType,
    sourceId: row.source_id as string,
    sourceTitle: row.source_title as string,
    triggerAt: row.trigger_at as string,
    remindBeforeMinutes: row.remind_before_minutes as number,
    isFired: row.is_fired as boolean,
    isDismissed: row.is_dismissed as boolean,
  };
}

export const alarmService = {
  async getPending(): Promise<Alarm[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    // Not filtered by trigger_at: useAlarms.ts's checkAndFire polls this
    // every 60s and fires exactly the alarms whose trigger_at has already
    // passed (alarm.triggerAt <= now). A `.gte('trigger_at', now)` filter
    // here would exclude precisely those due-or-overdue alarms, leaving
    // only ones still in the future -- which checkAndFire's own <=
    // comparison then never matches. Not-yet-fired, not-dismissed is the
    // whole "pending" definition; ordering still keeps the soonest first.
    const { data, error } = await supabase
      .from('alarms')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_fired', false)
      .eq('is_dismissed', false)
      .order('trigger_at');
    if (error) throw error;
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  },

  async setAlarm(params: {
    sourceType: AlarmSourceType;
    sourceId: string;
    sourceTitle: string;
    eventAt: string;
    remindBeforeMinutes: number;
  }): Promise<Alarm> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const triggerAt = new Date(
      new Date(params.eventAt).getTime() - params.remindBeforeMinutes * 60 * 1000,
    ).toISOString();

    await supabase.from('alarms').delete()
      .eq('user_id', user.id)
      .eq('source_id', params.sourceId);

    const { data, error } = await supabase
      .from('alarms')
      .insert({
        user_id: user.id,
        source_type: params.sourceType,
        source_id: params.sourceId,
        source_title: params.sourceTitle,
        trigger_at: triggerAt,
        remind_before_minutes: params.remindBeforeMinutes,
      })
      .select()
      .single();

    if (error) throw error;
    return mapRow(data as Record<string, unknown>);
  },

  async dismiss(id: string): Promise<void> {
    const { error } = await supabase
      .from('alarms').update({ is_dismissed: true }).eq('id', id);
    if (error) throw error;
  },

  async markFired(id: string): Promise<void> {
    const { error } = await supabase
      .from('alarms').update({ is_fired: true }).eq('id', id);
    if (error) throw error;
  },

  async removeForSource(sourceId: string): Promise<void> {
    const { error } = await supabase
      .from('alarms').delete().eq('source_id', sourceId);
    if (error) throw error;
  },

  async getForSource(sourceId: string): Promise<Alarm | null> {
    const { data } = await supabase
      .from('alarms')
      .select('*')
      .eq('source_id', sourceId)
      .eq('is_dismissed', false)
      .maybeSingle();
    return data ? mapRow(data as Record<string, unknown>) : null;
  },
};
