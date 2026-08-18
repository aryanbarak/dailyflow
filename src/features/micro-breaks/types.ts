// ADR-0014, MB-02 slice 1: Micro Breaks feature types. Classic Pong is the
// only implemented mode; the mode union already reflects all five
// PO-approved modes (ADR-0014 Context) since MicroBreaksMode is shared by
// the store/entry points regardless of which modes are actually playable
// yet -- only 'classic' has an engine/renderer today.
export type MicroBreaksMode = 'classic' | 'focus' | 'reaction' | 'memory' | 'quick-math';

// ADR-0014 §7: the frozen preset set. Slice 1 ships ONLY the 90s default as
// a wired constant -- 60/120 are defined here (so the type/set is frozen
// before the persistence slice per the ADR) but have no Settings UI yet.
export const MICRO_BREAK_DURATION_PRESETS_SECONDS = [60, 90, 120] as const;
export type MicroBreakDurationSeconds = (typeof MICRO_BREAK_DURATION_PRESETS_SECONDS)[number];
export const DEFAULT_MICRO_BREAK_DURATION_SECONDS: MicroBreakDurationSeconds = 90;

// MB-03, Slice 2, item 3: a defensive read-time normalizer, not just a
// write-time one -- zustand's `persist` middleware merges parsed JSON
// straight over the store's initial state with no domain validation, so a
// hand-edited or stale localStorage value outside the frozen preset set
// must still resolve to something safe wherever it's actually READ (the
// Settings UI's selected option, and the overlay at game-start), not just
// wherever it's written.
export function resolveMicroBreakDurationSeconds(value: unknown): MicroBreakDurationSeconds {
  return (MICRO_BREAK_DURATION_PRESETS_SECONDS as readonly unknown[]).includes(value)
    ? (value as MicroBreakDurationSeconds)
    : DEFAULT_MICRO_BREAK_DURATION_SECONDS;
}
