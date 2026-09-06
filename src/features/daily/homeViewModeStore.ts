import { create } from "zustand";
import { persist } from "zustand/middleware";

// CORE audit item 1-3 -- Home ("/") gets a second, opt-in mode: the
// existing Dashboard, or the new Daily infinite-scroll view. This is a
// per-viewer UI preference, same shape and scope as
// src/features/chat/chatDisplayPreferencesStore.ts (localStorage only,
// no Supabase column -- adding one would be a schema change outside this
// feature's scope). Default is 'dashboard': a first-time visitor sees
// nothing new until they opt in.

export type HomeViewMode = "dashboard" | "daily";

interface HomeViewModeState {
  mode: HomeViewMode;
  setMode: (mode: HomeViewMode) => void;
}

export const HOME_VIEW_MODE_STORAGE_KEY = "smartflow:home-view-mode";

export const useHomeViewModeStore = create<HomeViewModeState>()(
  persist(
    (set) => ({
      mode: "dashboard",
      setMode: (mode) => set({ mode }),
    }),
    { name: HOME_VIEW_MODE_STORAGE_KEY },
  ),
);
