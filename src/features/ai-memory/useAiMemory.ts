import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { aiMemoryService, type MemoryEntry } from './aiMemoryService';

export function useAiMemory() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setEntries(await aiMemoryService.getAll());
    } catch {
      toast.error('Failed to load AI memory');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // No `set`/`autoDetect` here by design -- ADR-0010 Q3 (Product Owner
  // amendment): user_context's write-freeze is COMPLETE. `remove` (erasure)
  // is the only mutation this hook still exposes.
  const remove = async (key: string) => {
    try {
      await aiMemoryService.delete(key);
      setEntries(prev => prev.filter(e => e.key !== key));
      toast.success('Memory cleared');
    } catch {
      toast.error('Failed to remove');
    }
  };

  const getValue = (key: string) => entries.find(e => e.key === key)?.value ?? '';
  const getSource = (key: string) => entries.find(e => e.key === key)?.source ?? null;

  return { entries, isLoading, remove, getValue, getSource };
}
