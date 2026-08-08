import { supabase } from '@/integrations/supabase/client';

// 'agent' is the source the Worker's legacy extraction wrote before ADR-0010
// Q4 disabled it (agent/worker/index.ts's ENABLE_AUTO_MEMORY_WRITE); 'ai' is
// the fourth value the user_context_source_check constraint has allowed
// since 20260616120000_user_context_allow_agent_source.sql but that no
// known write path in this codebase ever used. Both remain valid so any
// pre-existing row of either source still renders correctly (see the
// AiMemoryTab "AI" badge below) even though ADR-0010 Q3 freezes new writes
// to this table.
export type MemorySource = 'manual' | 'auto' | 'ai' | 'agent';

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  source: MemorySource;
  updatedAt: string;
}

export const MEMORY_KEYS = [
  { key: 'goal_primary',    label: 'Primary Goal',        placeholder: 'e.g. Find a job as Fachinformatiker' },
  { key: 'goal_secondary',  label: 'Secondary Goal',      placeholder: 'e.g. Learn React Native' },
  { key: 'work_status',     label: 'Work Status',         placeholder: 'e.g. Job seeking, completed IHK exam' },
  { key: 'mood_pattern',    label: 'Mood Pattern',        placeholder: 'Auto-detected from Journal' },
  { key: 'habit_pattern',   label: 'Habit Pattern',       placeholder: 'Auto-detected from Habits' },
  { key: 'finance_pattern', label: 'Finance Pattern',     placeholder: 'Auto-detected from Finance' },
  { key: 'family_note',     label: 'Family Notes',        placeholder: 'e.g. Kids school schedule' },
  { key: 'health_note',     label: 'Health Notes',        placeholder: 'e.g. Running 3x/week' },
  { key: 'learning_note',   label: 'Learning Focus',      placeholder: 'e.g. Studying algorithms' },
  { key: 'custom_1',        label: 'Custom Note 1',       placeholder: 'Anything you want AI to remember' },
  { key: 'custom_2',        label: 'Custom Note 2',       placeholder: 'Anything you want AI to remember' },
  { key: 'custom_3',        label: 'Custom Note 3',       placeholder: 'Anything you want AI to remember' },
] as const;

function mapRow(row: Record<string, unknown>): MemoryEntry {
  return {
    id: row.id as string,
    key: row.key as string,
    value: row.value as string,
    source: row.source as MemorySource,
    updatedAt: row.updated_at as string,
  };
}

export const aiMemoryService = {
  async getAll(): Promise<MemoryEntry[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('user_context')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>));
  },

  // No `set`/upsert method here by design -- ADR-0010 Q3 (Product Owner
  // amendment): the write-freeze on user_context is COMPLETE. There is no
  // remaining write path to this table anywhere in the app; read and
  // delete are the only supported operations. See AiMemoryTab.tsx for the
  // disabled-with-reason UI this removal requires there.

  async delete(key: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await supabase
      .from('user_context')
      .delete()
      .eq('user_id', user.id)
      .eq('key', key);
    if (error) throw error;
  },

  async getAsPromptContext(): Promise<string> {
    const entries = await aiMemoryService.getAll();
    const lines = entries
      .filter(e => e.value.trim())
      .map(e => {
        const label = MEMORY_KEYS.find(k => k.key === e.key)?.label ?? e.key;
        return `- ${label}: ${e.value}`;
      });
    if (!lines.length) return '';
    return `\n\nUSER CONTEXT (personal facts — use these to personalize your response):\n${lines.join('\n')}`;
  },

  // No `autoDetectAndSave` method here by design -- ADR-0010 Q3 (Product
  // Owner amendment): this table's write-freeze is COMPLETE, and this
  // function's sole purpose was writing derived mood/habit/finance
  // patterns into it. Removed rather than left disabled-but-callable, per
  // the same reasoning as `set` above.
};
