// CORE-W2 (2026-09-06, CORE audit item ۳-۴): browser side of the user
// persona document. User-authored ONLY (see migration 20260906120000's
// header for why there is deliberately no model write path); the worker
// reads it into the /chat system prompt.
import { supabase } from "@/integrations/supabase/client";

// Mirrors the user_persona CHECK constraint and the worker's
// USER_PERSONA_MAX_PROMPT_CHARS bound.
export const PERSONA_MAX_CHARS = 8000;

export const personaService = {
  async getPersona(userId: string): Promise<string> {
    const { data, error } = await supabase
      .from("user_persona")
      .select("content")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.content ?? "";
  },

  /** Upsert; an empty (whitespace-only) document deletes the row so the
   * worker's fetch cleanly resolves "no persona". */
  async savePersona(userId: string, content: string): Promise<void> {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      const { error } = await supabase.from("user_persona").delete().eq("user_id", userId);
      if (error) throw error;
      return;
    }
    const { error } = await supabase.from("user_persona").upsert({
      user_id: userId,
      content: trimmed.slice(0, PERSONA_MAX_CHARS),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
};
