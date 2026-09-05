import { useState, useEffect, useCallback } from "react";

export type ThemePreference = "light" | "dark" | "system";

interface Preferences {
  theme: ThemePreference;
  language?: string;
  currency?: string;
}

const PREFERENCES_KEY = "smartflow_preferences";

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

// DESIGN-AUDIT 0.6 (light mode): reads the CURRENT stored preference and
// applies it -- used by the OS color-scheme listener below so a stale hook
// instance (e.g. AppLayout's, mounted before the user changed the theme in
// Settings) can never re-apply an outdated choice. index.html's boot
// script duplicates this logic inline for the pre-paint frame; the two
// must stay in sync on the storage key and the system-fallback rule.
function applyStoredTheme() {
  let theme: ThemePreference = defaultPreferences.theme;
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    if (stored) theme = { ...defaultPreferences, ...JSON.parse(stored) }.theme;
  } catch {
    // Ignore parse errors
  }
  applyTheme(theme);
}

// DESIGN-AUDIT 0.6 (light mode): the resolved app theme as React state --
// tracks the html element's .dark class itself (the single source of
// truth every applier above writes to), so it stays correct no matter
// which usePreferences instance, boot script, or OS listener flipped it.
export function useResolvedAppTheme(): "dark" | "light" {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark ? "dark" : "light";
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
      applyStoredTheme();
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
