// CORE-W3 (2026-09-06, CORE audit items ۱-۱ + ۱-۲): the journal companion
// panel, rendered under the editor. Everything here is explicit and
// suggestion-only: detected checkboxes become tasks ONLY on a click,
// detected @ai instructions run ONLY on a click, and the journal text
// itself is never modified.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ListTodo, Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { Task } from "@/features/tasks/tasksService";
import { analyzeJournalDraft } from "../journalCompanion";
import { journalAiNotesService, type JournalAiNote } from "../journalAiNotesService";
import { runJournalInstruction, type JournalAssistantResult } from "../journalAssistantClient";

interface NotesServiceLike {
  listByDate(userId: string, entryDate: string): Promise<JournalAiNote[]>;
  delete(noteId: string): Promise<void>;
}

interface JournalCompanionProps {
  userId: string;
  date: string;
  /** The LIVE draft (not the persisted entry) so detection tracks typing. */
  content: string;
  /** Open tasks, for de-duplicating checkbox suggestions. */
  tasks: readonly Pick<Task, "title" | "completed">[];
  onCreateTask(payload: { title: string; notes: string }): Promise<unknown>;
  notesService?: NotesServiceLike;
  runInstruction?: typeof runJournalInstruction;
}

export function JournalCompanion({
  userId,
  date,
  content,
  tasks,
  onCreateTask,
  notesService = journalAiNotesService,
  runInstruction = runJournalInstruction,
}: JournalCompanionProps) {
  const { t } = useT();
  const [notes, setNotes] = useState<JournalAiNote[]>([]);
  const [createdTitles, setCreatedTitles] = useState<Set<string>>(new Set());
  const [busyTask, setBusyTask] = useState<number | null>(null);
  const [busyInstruction, setBusyInstruction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analysis = useMemo(() => analyzeJournalDraft(content), [content]);

  const loadNotes = useCallback(async () => {
    try {
      setNotes(await notesService.listByDate(userId, date));
    } catch {
      setNotes([]);
    }
  }, [notesService, userId, date]);

  useEffect(() => {
    setCreatedTitles(new Set());
    setError(null);
    void loadNotes();
  }, [loadNotes]);

  const openTaskTitles = useMemo(
    () => new Set(tasks.filter((task) => !task.completed).map((task) => task.title.trim().toLowerCase())),
    [tasks],
  );

  const pendingCheckboxes = analysis.checkboxes.filter(
    (checkbox) =>
      !openTaskTitles.has(checkbox.title.trim().toLowerCase()) &&
      !createdTitles.has(checkbox.title.trim().toLowerCase()),
  );

  const answeredInstructions = useMemo(
    () => new Set(notes.map((note) => note.instruction.trim())),
    [notes],
  );
  const pendingInstructions = analysis.instructions.filter(
    (item) => !answeredInstructions.has(item.instruction.trim()),
  );

  const hasAnything = pendingCheckboxes.length > 0 || pendingInstructions.length > 0 || notes.length > 0;
  if (!hasAnything) return null;

  const handleCreateTask = async (lineIndex: number, title: string) => {
    setBusyTask(lineIndex);
    setError(null);
    try {
      await onCreateTask({ title, notes: t("journal_task_source_note", { date }) });
      setCreatedTitles((prev) => new Set(prev).add(title.trim().toLowerCase()));
    } finally {
      setBusyTask(null);
    }
  };

  const handleRunInstruction = async (lineIndex: number, instruction: string) => {
    setBusyInstruction(lineIndex);
    setError(null);
    try {
      const result: JournalAssistantResult = await runInstruction(instruction, date, content);
      if (result.ok) {
        setNotes((prev) => [...prev, result.note]);
        if (!result.persisted) setError(t("journal_note_unsaved"));
      } else if ("message" in result) {
        // The `in` guard (not a plain else) because this tsconfig has
        // strictNullChecks off, where a bare else branch does not narrow
        // a boolean-discriminated union (verified against tsc 5.9).
        setError(result.message);
      }
    } finally {
      setBusyInstruction(null);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await notesService.delete(noteId);
      setNotes((prev) => prev.filter((note) => note.id !== noteId));
    } catch {
      setError(t("journal_note_delete_error"));
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/60 p-4" data-testid="journal-companion">
      {pendingCheckboxes.length > 0 && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ListTodo className="h-3.5 w-3.5" />
            {t("journal_checkboxes_heading")}
          </h4>
          <ul className="space-y-1.5">
            {pendingCheckboxes.map((checkbox) => (
              <li key={checkbox.lineIndex} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{checkbox.title}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 shrink-0"
                  disabled={busyTask === checkbox.lineIndex}
                  onClick={() => void handleCreateTask(checkbox.lineIndex, checkbox.title)}
                >
                  {busyTask === checkbox.lineIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {t("journal_make_task")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingInstructions.length > 0 && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            {t("journal_instructions_heading")}
          </h4>
          <ul className="space-y-1.5">
            {pendingInstructions.map((item) => (
              <li key={item.lineIndex} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{item.instruction}</span>
                <Button
                  size="sm"
                  className="gap-1 shrink-0"
                  disabled={busyInstruction === item.lineIndex}
                  onClick={() => void handleRunInstruction(item.lineIndex, item.instruction)}
                >
                  {busyInstruction === item.lineIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {t("journal_run_instruction")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            {t("journal_notes_heading")}
          </h4>
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id} className="rounded-lg bg-secondary/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{note.instruction}</p>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0 text-muted-foreground"
                    aria-label={t("journal_note_delete")}
                    onClick={() => void handleDeleteNote(note.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{note.reply}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="text-sm text-destructive" role="status">{error}</p>}
    </div>
  );
}
