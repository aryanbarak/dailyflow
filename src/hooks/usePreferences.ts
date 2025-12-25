import { useState, useEffect, useCallback } from "react";

export type ThemePreference = "light" | "dark" | "system";

interface Preferences {
  theme: ThemePreference;
  language?: string;
  currency?: string;
}

const PREFERENCES_KEY = "dailyflow_preferences";

const defaultPreferences: Preferences = {
  theme: "system",
  language: "en",
  currency: "USD",
};

function applyTheme(theme: ThemePreference) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const shouldUseDark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", shouldUseDark);
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      const stored = localStorage.getItem(PREFERENCES_KEY);
      if (stored) {
        return { ...defaultPreferences, ...JSON.parse(stored) };
      }
    } catch {
      // Ignore parse errors
    }
    return defaultPreferences;
  });

  useEffect(() => {
    applyTheme(preferences.theme);
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (preferences.theme === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [preferences.theme]);

  const updatePreferences = useCallback((updates: Partial<Preferences>) => {
    setPreferences((prev) => {
      const updated = { ...prev, ...updates };
      try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  }, []);

  const setTheme = useCallback((theme: ThemePreference) => {
    updatePreferences({ theme });
  }, [updatePreferences]);

  const setLanguage = useCallback((language: string) => {
    updatePreferences({ language });
  }, [updatePreferences]);

  const setCurrency = useCallback((currency: string) => {
    updatePreferences({ currency });
  }, [updatePreferences]);

  return {
    preferences,
    setTheme,
    setLanguage,
    setCurrency,
    updatePreferences,
  };
}
