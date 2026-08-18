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
