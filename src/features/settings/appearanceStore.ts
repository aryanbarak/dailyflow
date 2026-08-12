import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Density = 'compact' | 'normal' | 'comfortable';
export type AccentColor = 'indigo' | 'violet' | 'rose' | 'amber' | 'emerald' | 'sky';
export type Language = 'en' | 'de' | 'fa';

// Task 17h: the cursor-following pointer glow (SmartflowPointerFollower,
// restored app-wide by this task after 17g wrongly gated it off the chat
// page -- see AppLayout.tsx's own comment) is now user-configurable from
// Settings -> Appearance, which this store already backs end to end,
// hence extending IT rather than adding a dedicated orbPreferencesStore
// (the pattern chatDisplayPreferencesStore.ts documents as its own
// alternative for settings that AREN'T already owned by this store).
// user_settings (Supabase) has no appearance column -- same as every
// other field in this store, this persists to localStorage only; adding a
// server-synced column is out of scope here.
export type OrbSize = 'small' | 'medium' | 'large' | 'xl';
export type OrbColor = 'primary' | 'blue' | 'cyan' | 'study' | 'plan' | 'analyze' | 'review' | 'report' | 'career';

interface AppearanceState {
  density: Density;
  accentColor: AccentColor;
  reducedMotion: boolean;
  language: Language;
  orbEnabled: boolean;
  orbColor: OrbColor;
  orbSize: OrbSize;
  orbOpacity: number;
  setDensity: (d: Density) => void;
  setAccentColor: (c: AccentColor) => void;
  setReducedMotion: (v: boolean) => void;
  setLanguage: (l: Language) => void;
  setOrbEnabled: (v: boolean) => void;
  setOrbColor: (c: OrbColor) => void;
  setOrbSize: (s: OrbSize) => void;
  setOrbOpacity: (o: number) => void;
}

// Task 17h: colour choices are restricted to the EXISTING --flow-* palette
// (src/styles/flow-tokens.css) only -- no free colour picker, no new hex
// values. `primary` maps to --flow-primary, the same token --primary (and
// therefore the follower's ORIGINAL hardcoded hsl(var(--primary))) was
// already derived from in Dark Cosmic (see index.css's own comment: "256
// 100% 65%; /* --flow-primary #7C4DFF */"), so the default selection below
// renders IDENTICALLY to the pre-17h look.
export const ORB_COLOR_VAR: Record<OrbColor, string> = {
  primary: '--flow-primary',
  blue: '--flow-blue',
  cyan: '--flow-cyan',
  study: '--flow-study',
  plan: '--flow-plan',
  analyze: '--flow-analyze',
  review: '--flow-review',
  report: '--flow-report',
  career: '--flow-career',
};

// Task 17h: `medium` is exactly the follower's original hardcoded size
// (h-36/w-36 = 9rem = 144px), so the default step renders at an IDENTICAL
// pixel size to the pre-17h look.
export const ORB_SIZE_PX: Record<OrbSize, number> = {
  small: 96,
  medium: 144,
  large: 192,
  xl: 240,
};

// Task 17h: `0.72` is the follower's original hardcoded peak opacity, kept
// as one of the discrete steps (and the default) so nothing visually
// changes until a user actually moves this.
export const ORB_OPACITY_STEPS: readonly number[] = [0.3, 0.5, 0.72, 0.9, 1];

export const ACCENT_COLORS: Record<AccentColor, { label: string; hex: string; hsl: string }> = {
  indigo:  { label: 'Indigo',  hex: '#6366f1', hsl: '239 84% 67%' },
  violet:  { label: 'Violet',  hex: '#8b5cf6', hsl: '258 90% 66%' },
  rose:    { label: 'Rose',    hex: '#f43f5e', hsl: '347 77% 60%' },
  amber:   { label: 'Amber',   hex: '#f59e0b', hsl: '38 92% 50%'  },
  emerald: { label: 'Emerald', hex: '#10b981', hsl: '160 84% 39%' },
  sky:     { label: 'Sky',     hex: '#0ea5e9', hsl: '199 89% 48%' },
};

export const DENSITY_OPTIONS: { value: Density; label: string; desc: string }[] = [
  { value: 'compact',     label: 'Compact',      desc: 'Less space, more content' },
  { value: 'normal',      label: 'Normal',        desc: 'Default layout' },
  { value: 'comfortable', label: 'Comfortable',   desc: 'More spacing, easier reading' },
];

export const useAppearance = create<AppearanceState>()(
  persist(
    set => ({
      density: 'normal',
      accentColor: 'indigo',
      reducedMotion: false,
      language: 'en',
      orbEnabled: true,
      orbColor: 'primary',
      orbSize: 'medium',
      orbOpacity: 0.72,
      setDensity: density => set({ density }),
      setAccentColor: accentColor => {
        const { hsl } = ACCENT_COLORS[accentColor];
        document.documentElement.style.setProperty('--primary', hsl);
        set({ accentColor });
      },
      setReducedMotion: reducedMotion => set({ reducedMotion }),
      setLanguage: language => set({ language }),
      setOrbEnabled: orbEnabled => set({ orbEnabled }),
      setOrbColor: orbColor => set({ orbColor }),
      setOrbSize: orbSize => set({ orbSize }),
      setOrbOpacity: orbOpacity => set({ orbOpacity }),
    }),
    { name: 'smartflow:appearance' },
  ),
);
