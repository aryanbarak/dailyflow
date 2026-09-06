import { useEffect, useRef, useState } from 'react';
import { useJournalEntry, useUpsertJournalEntry } from '../useJournal';
import { MoodPicker } from './MoodPicker';
import type { Mood } from '../types';
import { useDebounce } from '@/hooks/useDebounce';

interface Props {
  readonly date: string;
  readonly promptInsert?: string | null;
  // CORE-W3: lets JournalPage mirror the LIVE draft (for the companion
  // panel's checkbox/@ai detection) without lifting this component's own
  // save/dirty state management.
  readonly onContentChange?: (content: string) => void;
}

const PLACEHOLDER = 'What happened today? How did you feel?';

export function JournalEditor({ date, promptInsert, onContentChange }: Props) {
  const { data: entry, isLoading } = useJournalEntry(date);
  const { mutate: upsert } = useUpsertJournalEntry();

  const [content, setContent] = useState('');
  const [mood, setMood] = useState<Mood | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = useRef(false);
  const loadedDate = useRef('');

  // When date changes, immediately block auto-save until new data loads
  useEffect(() => {
    if (loadedDate.current !== date) {
      dirty.current = false;
    }
  }, [date]);

  // Sync editor state when the entry for the selected date finishes loading
  useEffect(() => {
    if (isLoading) return;
    if (loadedDate.current === date) return;
    loadedDate.current = date;
    setContent(entry?.content ?? '');
    setMood(entry?.mood ?? null);
    dirty.current = false;
  }, [date, entry, isLoading]);

  useEffect(() => {
    if (promptInsert) {
      setContent(prev => prev + (prev.endsWith('\n') || prev === '' ? '' : '\n\n') + promptInsert);
      dirty.current = true;
    }
  }, [promptInsert]);

  // CORE-W3: mirror every content change (typing, date-switch load,
  // prompt insertion) to the optional observer -- one effect instead of
  // per-callsite calls, so no path can be missed.
  useEffect(() => {
    onContentChange?.(content);
  }, [content, onContentChange]);

  const debouncedContent = useDebounce(content, 1200);
  const debouncedMood = useDebounce(mood, 1200);

  // Auto-save only after user edits, never during date-switch transitions
  useEffect(() => {
    if (!dirty.current) return;
    upsert({ date, content: debouncedContent, mood: debouncedMood }, {
      onSuccess: () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
    });
  }, [debouncedContent, debouncedMood]);

  if (isLoading) return <div className="text-sm text-muted-foreground py-4">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <MoodPicker value={mood} onChange={(m) => { setMood(m); dirty.current = true; }} />
        <span className={`text-xs transition-opacity ${saved ? 'opacity-100 text-green-500' : 'opacity-0'}`}>
          Saved ✓
        </span>
      </div>
      <textarea
        className="w-full min-h-[280px] bg-transparent border border-border rounded-xl p-4 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground leading-relaxed"
        placeholder={PLACEHOLDER}
        value={content}
        onChange={e => { setContent(e.target.value); dirty.current = true; }}
        dir="auto"
        aria-label="Journal entry"
      />
    </div>
  );
}
