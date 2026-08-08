// SmartFlow -- Personal Memory Layer (ADR-0010), confirm/correct/reject/
// delete UI (task 6; docs/architecture/notes/personal-memory-review-ui-
// design-note.md).
//
// Presentation-layer discipline, mirroring InferredContextSection.tsx's own
// header comment exactly, one dimension over: this component displays
// PersonalMemoryRecord rows and submits explicit confirm/correct/reject/
// delete/extraction-trigger commands -- it derives no fact on its own.
// Every dependency (the record service, the extraction trigger) is
// injected via props, never imported from a Supabase client directly, so
// this file stays testable without any live/mocked Supabase config.
//
// ADR-0010 Q5: this component is the ONLY surface in the product where a
// `proposed` PersonalMemoryRecord is ever rendered. No consumer is wired
// here or anywhere else by this task.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buildPersonalMemoryContentFromForm,
  groupVisiblePersonalMemoryRecords,
  isPersonalMemoryRecordActionable,
  personalMemoryDisplayStatusHelpText,
  personalMemoryDisplayStatusLabel,
  personalMemoryFormInitialValues,
  personalMemoryKindLabel,
  personalMemoryRecordPrimaryText,
  personalMemoryRecordSecondaryText,
  PERSONAL_MEMORY_FORM_SCHEMAS,
  type PersonalMemoryDisplayEntry,
} from "../personalMemoryRecordPresentation";
import { validatePersonalMemoryContent } from "../personalMemoryRecordValidation";
import type { PersonalMemoryRecordService } from "../personalMemoryRecordService";
import type { PersonalMemoryContent, PersonalMemoryRecord, PersonalMemoryRecordKind } from "../personalMemoryRecordTypes";
import type { PersonalMemoryExtractionTriggerResult } from "../personalMemoryExtractionTriggerClient";

export interface PersonalMemorySectionProps {
  readonly service: Pick<PersonalMemoryRecordService, "listByOwner" | "resolve" | "remove">;
  readonly triggerExtraction: () => Promise<PersonalMemoryExtractionTriggerResult>;
  /** Called after any successful resolve/delete action or a successfully-completed extraction run. */
  readonly onRecordsChanged?: () => void;
}

const EXTRACTION_ERROR_MESSAGES: Record<string, string> = {
  NO_SOURCE_MATERIAL: "Not enough recent activity to extract from yet -- chat with SmartFlow or generate a briefing first.",
  CONFIGURATION_MISSING: "Personal memory extraction is not configured in this environment.",
  UNAUTHENTICATED: "Sign in again to check for new personal memory.",
};

function extractionErrorMessage(result: PersonalMemoryExtractionTriggerResult & { ok: false }): string {
  return EXTRACTION_ERROR_MESSAGES[result.code] ?? result.message;
}

function CorrectionForm({
  kind,
  content,
  busy,
  onCancel,
  onSubmit,
}: Readonly<{
  kind: PersonalMemoryRecordKind;
  content: PersonalMemoryContent;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (content: PersonalMemoryContent) => void;
}>) {
  const [values, setValues] = useState(() => personalMemoryFormInitialValues(kind, content));
  const [errors, setErrors] = useState<readonly string[]>([]);
  const schema = PERSONAL_MEMORY_FORM_SCHEMAS[kind];

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const candidate = buildPersonalMemoryContentFromForm(kind, values);
    const result = validatePersonalMemoryContent(kind, candidate);
    if (result.valid === false) {
      setErrors(result.errors.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    onSubmit(result.value);
  };

  return (
    <form className="mt-3 space-y-3 rounded-md border border-border bg-background/60 p-3" onSubmit={handleSubmit} aria-label={`Correct ${personalMemoryKindLabel(kind)} content`}>
      {schema.map((fieldSchema) => (
        <div key={fieldSchema.name}>
          <label className="block text-xs font-medium text-muted-foreground" htmlFor={`pm-correction-${kind}-${fieldSchema.name}`}>
            {fieldSchema.label}
            {fieldSchema.required ? " (required)" : " (optional)"}
          </label>
          {fieldSchema.input === "select" ? (
            <select
              id={`pm-correction-${kind}-${fieldSchema.name}`}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={values[fieldSchema.name] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [fieldSchema.name]: event.target.value }))}
            >
              <option value="">Select…</option>
              {fieldSchema.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`pm-correction-${kind}-${fieldSchema.name}`}
              type="text"
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              value={values[fieldSchema.name] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [fieldSchema.name]: event.target.value }))}
            />
          )}
        </div>
      ))}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Submit correction
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RecordCard({
  entry,
  busy,
  correcting,
  showingOriginal,
  onToggleOriginal,
  onConfirm,
  onReject,
  onStartCorrect,
  onCancelCorrect,
  onSubmitCorrect,
  onRequestDelete,
  error,
}: Readonly<{
  entry: PersonalMemoryDisplayEntry;
  busy: boolean;
  correcting: boolean;
  showingOriginal: boolean;
  onToggleOriginal: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onStartCorrect: () => void;
  onCancelCorrect: () => void;
  onSubmitCorrect: (content: PersonalMemoryContent) => void;
  onRequestDelete: () => void;
  error?: string;
}>) {
  const { record, displayStatus, originalRecord } = entry;
  const actionable = isPersonalMemoryRecordActionable(record);
  const helpText = personalMemoryDisplayStatusHelpText(displayStatus);

  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{personalMemoryRecordPrimaryText(record.content)}</p>
          {personalMemoryRecordSecondaryText(record.kind, record.content) && (
            <p className="mt-0.5 text-xs text-muted-foreground">{personalMemoryRecordSecondaryText(record.kind, record.content)}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <span className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {personalMemoryDisplayStatusLabel(displayStatus)}
          </span>
          {helpText && <p className="mt-1 max-w-[14rem] text-[11px] text-muted-foreground">{helpText}</p>}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {displayStatus === "corrected" && originalRecord && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onToggleOriginal}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showingOriginal ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
            View original
          </button>
          {showingOriginal && (
            <div className="mt-1 rounded-md border border-border bg-muted/40 p-2">
              <p className="text-[11px] font-medium text-muted-foreground">Superseded by your correction</p>
              <p className="mt-1 text-xs text-muted-foreground">{personalMemoryRecordPrimaryText(originalRecord.content)}</p>
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {actionable && !correcting && (
          <>
            <Button type="button" size="sm" onClick={onConfirm} disabled={busy}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Confirm
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onStartCorrect} disabled={busy}>
              Correct
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={onReject} disabled={busy}>
              <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Reject
            </Button>
          </>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onRequestDelete} disabled={busy} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Delete
        </Button>
      </div>
      {actionable && correcting && (
        <CorrectionForm kind={record.kind} content={record.content} busy={busy} onCancel={onCancelCorrect} onSubmit={onSubmitCorrect} />
      )}
    </li>
  );
}

export function PersonalMemorySection({ service, triggerExtraction, onRecordsChanged }: Readonly<PersonalMemorySectionProps>) {
  const [records, setRecords] = useState<readonly PersonalMemoryRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);
  const [recordErrors, setRecordErrors] = useState<Readonly<Record<string, string>>>({});
  const [correctingRecordId, setCorrectingRecordId] = useState<string | null>(null);
  const [showOriginalForId, setShowOriginalForId] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PersonalMemoryRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [extractionRunning, setExtractionRunning] = useState(false);
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await service.listByOwner();
      setRecords(result);
    } catch {
      setLoadError("Personal memory could not be loaded.");
    }
  }, [service]);

  useEffect(() => {
    setRecords(null);
    load();
  }, [load]);

  const handleResolve = useCallback(
    async (recordId: string, action: "confirm" | "correct" | "reject", correctedContent?: PersonalMemoryContent) => {
      setBusyRecordId(recordId);
      setRecordErrors((current) => {
        const next = { ...current };
        delete next[recordId];
        return next;
      });
      try {
        await service.resolve({ recordId, action, ...(correctedContent !== undefined ? { correctedContent } : {}) });
        setCorrectingRecordId(null);
        await load();
        onRecordsChanged?.();
      } catch (error) {
        setRecordErrors((current) => ({
          ...current,
          [recordId]: error instanceof Error ? error.message : "The action could not be completed.",
        }));
      } finally {
        setBusyRecordId(null);
      }
    },
    [load, onRecordsChanged, service],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const recordId = deleteTarget.id;
    setDeleting(true);
    try {
      await service.remove(recordId);
      setDeleteTarget(null);
      await load();
      onRecordsChanged?.();
    } catch (error) {
      setRecordErrors((current) => ({
        ...current,
        [recordId]: error instanceof Error ? error.message : "Delete failed.",
      }));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, load, onRecordsChanged, service]);

  const handleTriggerExtraction = useCallback(async () => {
    setExtractionRunning(true);
    setExtractionMessage(null);
    const result = await triggerExtraction();
    setExtractionRunning(false);
    // Explicit `=== false`, not a bare `!result.ok` -- documented precedent
    // in this repo's non-strict-tsconfig union-narrowing gotcha
    // (contextRebuildService.ts, InferredContextSection.tsx).
    if (result.ok === false) {
      setExtractionMessage(extractionErrorMessage(result));
      return;
    }
    setExtractionMessage(`Extraction complete: ${result.acceptedCount} accepted, ${result.droppedCount} dropped.`);
    await load();
    onRecordsChanged?.();
  }, [load, onRecordsChanged, triggerExtraction]);

  const grouped = records ? groupVisiblePersonalMemoryRecords(records, { showRejected }) : [];

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="personal-memory-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="personal-memory-heading" className="text-sm font-semibold text-foreground">
          Personal memory
        </h3>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setShowRejected((current) => !current)}>
            {showRejected ? "Hide rejected" : "Show rejected"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleTriggerExtraction} disabled={extractionRunning}>
            <RefreshCw className={extractionRunning ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"} aria-hidden="true" />
            {extractionRunning ? "Checking…" : "Check for new personal memory"}
          </Button>
        </div>
      </div>

      {extractionMessage && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">
          {extractionMessage}
        </p>
      )}
      {loadError && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {loadError}
        </p>
      )}
      {records === null && !loadError && <p className="mt-3 text-sm text-muted-foreground">Loading personal memory…</p>}
      {records !== null && grouped.length === 0 && !loadError && (
        <p className="mt-3 text-sm text-muted-foreground">No personal memory recorded yet.</p>
      )}

      {grouped.map(({ kind, entries }) => (
        <div key={kind} className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{personalMemoryKindLabel(kind)}</h4>
          <ul className="mt-2 space-y-2">
            {entries.map((entry) => (
              <RecordCard
                key={entry.record.id}
                entry={entry}
                busy={busyRecordId === entry.record.id}
                correcting={correctingRecordId === entry.record.id}
                showingOriginal={showOriginalForId === entry.record.id}
                error={recordErrors[entry.record.id]}
                onToggleOriginal={() => setShowOriginalForId((current) => (current === entry.record.id ? null : entry.record.id))}
                onConfirm={() => handleResolve(entry.record.id, "confirm")}
                onReject={() => handleResolve(entry.record.id, "reject")}
                onStartCorrect={() => setCorrectingRecordId(entry.record.id)}
                onCancelCorrect={() => setCorrectingRecordId(null)}
                onSubmitCorrect={(content) => handleResolve(entry.record.id, "correct", content)}
                onRequestDelete={() => setDeleteTarget(entry.record)}
              />
            ))}
          </ul>
        </div>
      ))}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this memory. The same fact may be re-extracted and proposed again later --
              deleting removes both the memory and its duplicate-check, so it will not be silently blocked from reappearing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={deleting}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
