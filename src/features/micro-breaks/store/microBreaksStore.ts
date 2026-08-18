import { create } from 'zustand';
import type { MicroBreaksMode } from '../types';

// ADR-0014 §5/§9: session-only, in-memory (NO persist middleware -- score
// dies on exit in slice 1, no localStorage yet). `gameActive` is the flag
// SmartflowPointerFollower reads to fully suspend its own rAF loop and
// window listeners while a break is active -- deliberately kept OUT of
// appearanceStore (ADR-0014 §5: "NOT in appearanceStore").
interface MicroBreaksState {
  readonly gameActive: boolean;
  readonly mode: MicroBreaksMode;
  readonly score: number;
  readonly startBreak: (mode?: MicroBreaksMode) => void;
  readonly endBreak: () => void;
  readonly setScore: (score: number) => void;
}

export const useMicroBreaksStore = create<MicroBreaksState>()(set => ({
  gameActive: false,
  mode: 'classic',
  score: 0,
  startBreak: (mode = 'classic') => set({ gameActive: true, mode, score: 0 }),
  endBreak: () => set({ gameActive: false }),
  setScore: score => set({ score }),
}));
