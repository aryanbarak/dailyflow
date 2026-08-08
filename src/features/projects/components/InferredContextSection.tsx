// SmartFlow -- Inferred Project Context Layer (ADR-0009), confirm/correct UI
// (task 4; docs/architecture/notes/inference-review-ui-design-note.md).
//
// Presentation-layer discipline (project-domain.md section 10): this
// component displays InferredProjectContextField rows and submits explicit
// confirm/correct/reject commands -- it derives no canonical fact on its
// own. Every dependency (the field service, the derivation trigger) is
// injected via props, never imported from a Supabase client directly, so
// this file stays testable without any live/mocked Supabase config.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildInferredFieldContentFromForm,
  groupVisibleInferredFields,
  inferredFieldDisplayStatus,
  inferredFieldDisplayStatusLabel,
  inferredFieldFormInitialValues,
  inferredFieldKindLabel,
  inferredFieldPrimaryText,
  inferredFieldSecondaryText,
  INFERRED_FIELD_FORM_SCHEMAS,
  isActionable,
} from "../inferredContextFieldPresentation";
import { validateInferredFieldContent } from "../inferredProjectContextFieldValidation";
import type { InferredProjectContextFieldService } from "../inferredProjectContextFieldService";
import type { InferredContextFieldKind, InferredFieldContent, InferredProjectContextField } from "../inferredProjectContextFieldTypes";
import type { ContextDerivationTriggerResult } from "../contextDerivationTriggerClient";

export interface InferredContextSectionProps {
  readonly projectId: string;
  readonly archived: boolean;
  readonly service: Pick<InferredProjectContextFieldService, "listByProject" | "resolve">;
  readonly triggerDerivation: (projectId: string) => Promise<ContextDerivationTriggerResult>;
  /** Called after any successful resolve action or a successfully-completed derivation run, so the caller can re-read ProjectContext/the Project Brief too. */
  readonly onContextChanged?: () => void;
}

const DERIVATION_ERROR_MESSAGES: Record<string, string> = {
  NO_ELIGIBLE_EVIDENCE: "This project has no evidence yet. Add evidence before deriving context.",
  PROJECT_ARCHIVED: "This project is archived. Reactivate it before deriving context.",
  CONFIGURATION_MISSING: "Context derivation is not configured in this environment.",
  UNAUTHENTICATED: "Sign in again to derive context from evidence.",
};

function derivationErrorMessage(result: ContextDerivationTriggerResult & { ok: false }): string {
  return DERIVATION_ERROR_MESSAGES[result.code] ?? result.message;
}

function CorrectionForm({
  kind,
  content,
  busy,
  onCancel,
  onSubmit,
}: Readonly<{
  kind: InferredContextFieldKind;
  content: InferredProjectContextField["content"];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (content: InferredFieldContent) => void;
}>) {
  const [values, setValues] = useState(() => inferredFieldFormInitialValues(kind, content));
  const [errors, setErrors] = useState<readonly string[]>([]);
  const schema = INFERRED_FIELD_FORM_SCHEMAS[kind];

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const candidate = buildInferredFieldContentFromForm(kind, values);
    const result = validateInferredFieldContent(kind, candidate);
    if (result.valid === false) {
      setErrors(result.errors.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    onSubmit(result.value);
  };

  return (
    <form className="mt-3 space-y-3 rounded-md border border-border bg-background/60 p-3" onSubmit={handleSubmit} aria-label={`Correct ${inferredFieldKindLabel(kind)} content`}>
      {schema.map((fieldSchema) => (
        <div key={fieldSchema.name}>
          <label className="block text-xs font-medium text-muted-foreground" htmlFor={`correction-${kind}-${fieldSchema.name}`}>
            {fieldSchema.label}
            {fieldSchema.required ? " (required)" : " (optional)"}
          </label>
          {fieldSchema.input === "select" ? (
            <select
              id={`correction-${kind}-${fieldSchema.name}`}
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
          ) : fieldSchema.input === "textarea" ? (
            <textarea
              id={`correction-${kind}-${fieldSchema.name}`}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              rows={3}
              value={values[fieldSchema.name] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [fieldSchema.name]: event.target.value }))}
            />
          ) : (
            <input
              id={`correction-${kind}-${fieldSchema.name}`}
              type={fieldSchema.input === "number" ? "number" : "text"}
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

function FieldCard({
  field,
  busy,
  correcting,
  onConfirm,
  onReject,
  onStartCorrect,
  onCancelCorrect,
  onSubmitCorrect,
  error,
}: Readonly<{
  field: InferredProjectContextField;
  busy: boolean;
  correcting: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onStartCorrect: () => void;
  onCancelCorrect: () => void;
  onSubmitCorrect: (content: InferredFieldContent) => void;
  error?: string;
}>) {
  const displayStatus = inferredFieldDisplayStatus(field);
  if (!displayStatus) return null;
  const actionable = isActionable(field);

  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{inferredFieldPrimaryText(field.kind, field.content)}</p>
          {inferredFieldSecondaryText(field.kind, field.content) && (
            <p className="mt-0.5 text-xs text-muted-foreground">{inferredFieldSecondaryText(field.kind, field.content)}</p>
          )}
        </div>
        <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {inferredFieldDisplayStatusLabel(displayStatus)}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {actionable && !correcting && (
        <div className="mt-3 flex gap-2">
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
        </div>
      )}
      {actionable && correcting && (
        <CorrectionForm kind={field.kind} content={field.content} busy={busy} onCancel={onCancelCorrect} onSubmit={onSubmitCorrect} />
      )}
    </li>
  );
}

export function InferredContextSection({ projectId, archived, service, triggerDerivation, onContextChanged }: Readonly<InferredContextSectionProps>) {
  const [fields, setFields] = useState<readonly InferredProjectContextField[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyFieldId, setBusyFieldId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [correctingFieldId, setCorrectingFieldId] = useState<string | null>(null);
  const [derivationRunning, setDerivationRunning] = useState(false);
  const [derivationMessage, setDerivationMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await service.listByProject(projectId);
      setFields(result);
    } catch {
      setLoadError("Inferred context could not be loaded.");
    }
  }, [projectId, service]);

  useEffect(() => {
    setFields(null);
    load();
  }, [load]);

  const handleResolve = useCallback(
    async (fieldId: string, action: "confirm" | "correct" | "reject", correctedContent?: InferredFieldContent) => {
      setBusyFieldId(fieldId);
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[fieldId];
        return next;
      });
      try {
        await service.resolve({ fieldId, action, ...(correctedContent !== undefined ? { correctedContent } : {}) });
        setCorrectingFieldId(null);
        await load();
        onContextChanged?.();
      } catch (error) {
        setFieldErrors((current) => ({
          ...current,
          [fieldId]: error instanceof Error ? error.message : "The action could not be completed.",
        }));
      } finally {
        setBusyFieldId(null);
      }
    },
    [load, onContextChanged, service],
  );

  const handleDerive = useCallback(async () => {
    setDerivationRunning(true);
    setDerivationMessage(null);
    const result = await triggerDerivation(projectId);
    setDerivationRunning(false);
    // Explicit `=== false`, not a bare `!result.ok`: under this project's
    // non-strict tsconfig, plain truthiness does not reliably narrow a
    // boolean-discriminated union to its `ok: false` member (documented
    // precedent in contextRebuildService.ts).
    if (result.ok === false) {
      setDerivationMessage(derivationErrorMessage(result));
      return;
    }
    setDerivationMessage(`Derivation complete: ${result.acceptedCount} accepted, ${result.droppedCount} dropped.`);
    await load();
    onContextChanged?.();
  }, [load, onContextChanged, projectId, triggerDerivation]);

  const grouped = fields ? groupVisibleInferredFields(fields) : [];

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="inferred-context-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="inferred-context-heading" className="text-sm font-semibold text-foreground">
          Inferred understanding
        </h3>
        <Button type="button" size="sm" variant="outline" onClick={handleDerive} disabled={archived || derivationRunning}>
          <RefreshCw className={derivationRunning ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"} aria-hidden="true" />
          {derivationRunning ? "Deriving…" : "Derive from evidence"}
        </Button>
      </div>
      {archived && <p className="mt-2 text-xs text-muted-foreground">Derivation is disabled because this project is archived.</p>}
      {derivationMessage && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">
          {derivationMessage}
        </p>
      )}
      {loadError && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {loadError}
        </p>
      )}
      {fields === null && !loadError && <p className="mt-3 text-sm text-muted-foreground">Loading inferred context…</p>}
      {fields !== null && grouped.length === 0 && !loadError && (
        <p className="mt-3 text-sm text-muted-foreground">No inferred objectives, milestones, decisions, risks, capabilities, or candidate actions yet.</p>
      )}
      {grouped.map(({ kind, fields: kindFields }) => (
        <div key={kind} className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{inferredFieldKindLabel(kind)}</h4>
          <ul className="mt-2 space-y-2">
            {kindFields.map((field) => (
              <FieldCard
                key={field.id}
                field={field}
                busy={busyFieldId === field.id}
                correcting={correctingFieldId === field.id}
                error={fieldErrors[field.id]}
                onConfirm={() => handleResolve(field.id, "confirm")}
                onReject={() => handleResolve(field.id, "reject")}
                onStartCorrect={() => setCorrectingFieldId(field.id)}
                onCancelCorrect={() => setCorrectingFieldId(null)}
                onSubmitCorrect={(content) => handleResolve(field.id, "correct", content)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
