// CORE-W3 (2026-09-06, CORE audit item ۱-۱): reads/deletes the journal
// assistant notes (journal_ai_notes). Creation happens only through the
// Worker route (journalAssistantClient.ts) -- with the user's own JWT, so
// the same RLS scope as these calls.
import { supabase } from "@/integrations/supabase/client";

export interface JournalAiNote {
  id: string;
  instruction: string;
  reply: string;
  createdAt: string;
}

export const journalAiNotesService = {
  async listByDate(userId: string, entryDate: string): Promise<JournalAiNote[]> {
    const { data, error } = await supabase
      .from("journal_ai_notes")
      .select("id,instruction,reply,created_at")
      .eq("user_id", userId)
      .eq("entry_date", entryDate)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      instruction: row.instruction,
      reply: row.reply,
      createdAt: row.created_at,
    }));
  },

  async delete(noteId: string): Promise<void> {
    const { error } = await supabase.from("journal_ai_notes").delete().eq("id", noteId);
    if (error) throw error;
  },
};
