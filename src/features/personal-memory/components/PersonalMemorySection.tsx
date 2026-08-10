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
import { isolateEmbeddedBidiRuns } from "@/lib/bidiText";
import { useT } from "@/i18n";
import type { ResolveDocumentChunkSources } from "@/features/documents/documentChunkSourceResolver";
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
  /** Task 16: resolves live document_chunks info for a document-sourced record's source line. Omit to render document-sourced cards with no source line (graceful degradation, not an error). */
  readonly resolveDocumentSources?: ResolveDocumentChunkSources;
  /** Called after any successful resolve/delete action or a successfully-completed extraction run. */
  readonly onRecordsChanged?: () => void;
}

const EXTRACTION_ERROR_MESSAGES: Record<string, string> = {
  NO_SOURCE_MATERIAL: "Not enough recent activity to extract from yet -- chat with SmartFlow or generate a briefing first.",
  CONFIGURATION_MISSING: "Personal memory extraction is not configured in this environment.",
  UNAUTHENTICATED: "Sign in again to check for new personal memory.",
  // Task 14 fix: distinct, honest messages for the worker's three-way
  // model-call taxonomy -- these previously all collapsed into the single
  // "The model did not return a usable extraction." even when the model
  // was never successfully asked (a rejected request, or the provider
  // being down). Explicit here rather than relying on the worker's own
  // message text falling through unmodified, so this UI's wording doesn't
  // silently drift if the worker's message ever changes.
  PROVIDER_REQUEST_REJECTED: "The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your data.",
  PROVIDER_UNAVAILABLE: "The AI model is temporarily unavailable. Please try again in a moment.",
  MODEL_OUTPUT_UNUSABLE: "The model did not return a usable extraction. Please try again.",
};

function extractionErrorMessage(result: PersonalMemoryExtractionTriggerResult & { ok: false }): string {
  return EXTRACTION_ERROR_MESSAGES[result.code] ?? result.message;
}

// Task 16 (Document-Sourced Memory slice 1): builds a document-sourced
// record's "file.pdf — Section (via AI transcription)" source line. Reads
// the live-resolved chunk map first (documentSources); falls back to the
// record's own provenanceSnapshot for a ref id the live join no longer has
// (chunk deleted by re-extraction or a document hard-delete -- see
// 20260811010000_personal_memory_document_provenance.sql's snapshot
// trigger). Only the FIRST resolvable cited chunk is shown -- in practice
// a candidate cites exactly one, and a single line is what the design
// (docs "resume.pdf — work experience section") calls for.
function documentSourceLine(
  record: PersonalMemoryRecord,
  documentSources: Readonly<Record<string, { fileName: string; sectionLabel: string }>>,
  t: (key: "personal_memory_document_source_line", vars: Record<string, string>) => string,
): string | undefined {
  if (record.provenance.sourceKind !== "document") return undefined;
  for (const chunkId of record.provenance.sourceReferenceIds) {
    const live = documentSources[chunkId];
    if (live) return t("personal_memory_document_source_line", { fileName: live.fileName, section: live.sectionLabel });
    const snapshotEntry = record.provenanceSnapshot?.find((entry) => entry.chunkId === chunkId);
    if (snapshotEntry) {
      return t("personal_memory_document_source_line", { fileName: snapshotEntry.fileName, section: snapshotEntry.sectionLabel });
    }
  }
  return undefined;
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
  sourceLine,
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
  /** Task 16: only set for a document-sourced record with a resolvable source (live or snapshot). */
  sourceLine?: string;
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
          {/* Task 11e: mixed-direction hygiene -- these titles/summaries are
              derived from user content (chat, briefings) and can freely mix
              Persian and Latin tokens (a product name, a URL). dir="auto"
              picks the block's own base direction; isolateEmbeddedBidiRuns
              isolates any bare embedded Latin run so it can't visually
              reorder relative to its own surrounding punctuation. */}
          <p dir="auto" className="text-sm font-medium text-foreground">
            {isolateEmbeddedBidiRuns(personalMemoryRecordPrimaryText(record.content))}
          </p>
          {personalMemoryRecordSecondaryText(record.kind, record.content) && (
            <p dir="auto" className="mt-0.5 text-xs text-muted-foreground">
              {isolateEmbeddedBidiRuns(personalMemoryRecordSecondaryText(record.kind, record.content))}
            </p>
          )}
          {/* Task 16: document provenance source line -- file name can be
              user-controlled (upload) and mix directions, same bidi
              treatment as the primary/secondary text above. */}
          {sourceLine && (
            <p dir="auto" className="mt-0.5 text-[11px] italic text-muted-foreground/80">
              {isolateEmbeddedBidiRuns(sourceLine)}
            </p>
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

export function PersonalMemorySection({ service, triggerExtraction, resolveDocumentSources, onRecordsChanged }: Readonly<PersonalMemorySectionProps>) {
  const { t } = useT();
  const [records, setRecords] = useState<readonly PersonalMemoryRecord[] | null>(null);
  const [documentSources, setDocumentSources] = useState<Readonly<Record<string, { fileName: string; sectionLabel: string }>>>({});
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

  // Task 16: resolve live document_chunks info for every document-sourced
  // record's source line, once per records load. Batched into a single
  // call (all cited chunk ids across all records at once) rather than one
  // call per record.
  useEffect(() => {
    if (!records || !resolveDocumentSources) return;
    const chunkIds = records
      .filter((record) => record.provenance.sourceKind === "document")
      .flatMap((record) => record.provenance.sourceReferenceIds);
    if (chunkIds.length === 0) return;
    let cancelled = false;
    resolveDocumentSources(chunkIds)
      .then((resolved) => {
        if (!cancelled) setDocumentSources(resolved);
      })
      .catch(() => {
        // Best-effort: a resolution failure just means document-sourced
        // cards fall back to their snapshot (or show no source line) --
        // never a load-blocking error.
      });
    return () => {
      cancelled = true;
    };
  }, [records, resolveDocumentSources]);

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
    // Task 12: zero NEW facts (nothing accepted -- whether because the model
    // proposed none, or everything proposed was a duplicate/invalid and
    // dropped) is a calm, ordinary outcome, not a failure -- rendered
    // distinctly from the accepted/dropped breakdown so it doesn't read like
    // an error state.
    setExtractionMessage(
      result.acceptedCount === 0
        ? "No new personal memory found."
        : `Extraction complete: ${result.acceptedCount} accepted, ${result.droppedCount} dropped.`,
    );
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
                sourceLine={documentSourceLine(entry.record, documentSources, t)}
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
