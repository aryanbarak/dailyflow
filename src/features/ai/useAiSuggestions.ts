import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAppearance } from "@/features/settings/appearanceStore";
import {
  getAiResponseLanguageInstruction,
  getStoredAiResponseLanguage,
  resolveAiResponseLanguage,
} from "@/features/ai/responseLanguage";

export interface AiSuggestion {
  text: string;
  type: string;
  suggestedDate?: string;
}

// DESIGN-AUDIT phase 4: the one Gemini-suggestions fetch that Tasks,
// Habits, Calendar and Finance each hand-rolled (same session lookup, same
// response-language payload, same fetch-once ref guard, same error->[]
// fallback). `endpoint` is the worker path segment ('tasks', 'habits',
// 'calendar', 'finance').
//
// Auto mode (default): fetches once, the first time `enabled` is true, and
// starts in the loading state so pages can show their skeleton card before
// data arrives -- exactly the behavior the inline copies had. Manual mode
// (`manual: true`, Finance) starts idle and fetches only when `request()`
// is called.
export function useAiSuggestions(options: {
  endpoint: string;
  enabled?: boolean;
  manual?: boolean;
}) {
  const { endpoint, enabled = true, manual = false } = options;
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(!manual);
  const loadedRef = useRef(false);
  const interfaceLanguage = useAppearance((state) => state.language);
  const workerUrl = import.meta.env.VITE_AGENT_WORKER_URL as string;

  const request = useCallback(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setIsLoading(true);
    supabase.auth.getSession().then(({ data: { session: authSession } }) => {
      if (!authSession) {
        setIsLoading(false);
        return;
      }
      const responseLanguage = resolveAiResponseLanguage({
        configuredResponseLanguage: getStoredAiResponseLanguage(),
        interfaceLanguage,
      });
      fetch(`${workerUrl}/${endpoint}/suggestions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authSession.access_token}`,
        },
        body: JSON.stringify({
          responseLanguage,
          responseLanguageInstruction: getAiResponseLanguageInstruction(responseLanguage),
        }),
      })
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((body: { suggestions: AiSuggestion[] }) => {
          setSuggestions(body.suggestions ?? []);
        })
        .catch(() => setSuggestions([]))
        .finally(() => setIsLoading(false));
    });
  }, [endpoint, workerUrl, interfaceLanguage]);

  useEffect(() => {
    if (manual || !enabled) return;
    request();
  }, [manual, enabled, request]);

  return { suggestions, isLoading, request };
}
