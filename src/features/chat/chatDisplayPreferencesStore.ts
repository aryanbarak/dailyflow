import { create } from "zustand";
import { persist } from "zustand/middleware";

// SmartFlow -- Chat Experience v2 (task 17a). Theme + density preferences
// SCOPED TO THE CHAT PAGE, deliberately not the app-wide
// src/features/settings/appearanceStore.ts:
//
// - Theme: the app's global theme mechanism (src/hooks/usePreferences.ts,
//   toggling a `.dark` class on <html>) is only ever instantiated from
//   SettingsPage, and index.html hardcodes `class="dark"` on the root
//   element -- there is no working global light path today, and this
//   task's own requirement ("default follows prefers-color-scheme") would
//   conflict with that hardcoding if reused as-is. A page-scoped
//   mechanism keeps this fix self-contained to "chat page scope" (this
//   task's own repeated framing) with zero risk to every other page's
//   current (dark, hardcoded) appearance.
// - Density: appearanceStore.ts's `density` field (compact/normal/
//   comfortable) is a three-state, currently-UNCONSUMED app-wide setting
//   (only SettingsPage writes it; nothing reads it yet). This task's
//   compact mode is a two-state, chat-bubble-specific density the PO
//   explicitly wants "persisted alongside the theme preference" in "a
//   small chat-header settings cluster" -- i.e. the SAME mechanism as
//   theme, not a third consumer of a global field with different
//   semantics (2-state vs 3-state) that would need its own mapping either
//   way.
//
// user_settings (Supabase) has no appearance/theme/density column today
// (see supabase/integrations/supabase/types.ts) -- adding one is a schema
// change outside this task's frontend-only scope, so this persists to
// localStorage, exactly like appearanceStore.ts and usePreferences.ts
// already do for their own equivalents.

export type ChatTheme = "light" | "dark";
export type ChatDensity = "comfortable" | "compact";

interface ChatDisplayPreferencesState {
  theme: ChatTheme;
  density: ChatDensity;
  setTheme: (theme: ChatTheme) => void;
  setDensity: (density: ChatDensity) => void;
  toggleTheme: () => void;
  toggleDensity: () => void;
}

/** Guarded for SSR/jsdom -- matchMedia is not implemented in every test environment. */
export function systemPrefersDarkChatTheme(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

export const CHAT_DISPLAY_PREFERENCES_STORAGE_KEY = "smartflow:chat-display-preferences";

export const useChatDisplayPreferences = create<ChatDisplayPreferencesState>()(
  persist(
    (set, get) => ({
      // Default only takes effect before anything has ever been persisted
      // (persist's rehydration overrides this with the stored value once
      // one exists) -- "default follows prefers-color-scheme" applies to
      // a user's first visit, not every load.
      theme: systemPrefersDarkChatTheme() ? "dark" : "light",
      density: "comfortable",
      setTheme: (theme) => set({ theme }),
      setDensity: (density) => set({ density }),
      toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
      toggleDensity: () => set({ density: get().density === "compact" ? "comfortable" : "compact" }),
    }),
    { name: CHAT_DISPLAY_PREFERENCES_STORAGE_KEY },
  ),
);
