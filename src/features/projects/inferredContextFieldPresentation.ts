// SmartFlow -- Inferred Project Context Layer (ADR-0009), confirm/correct UI
// (task 4; docs/architecture/notes/inference-review-ui-design-note.md).
//
// Pure, deterministic display/formatting helpers over
// InferredProjectContextField -- no I/O, no fetching, no mutation. Kept
// separate from the React component so the disambiguation rule below is
// unit-testable without rendering anything.
//
// resolve_inferred_context_field's own transition rules (see the migration)
// make `status` alone ambiguous for a "confirmed" row: a plain confirm keeps
// source="model" on the SAME row, while a correction inserts a NEW
// source="user" row that also carries status="user_confirmed". This module
// disambiguates on (status, source, supersedesId), never on status alone --
// see the design note's disambiguation table.

import type {
  InferredContextFieldKind,
  InferredFieldContent,
  InferredProjectContextField,
} from "./inferredProjectContextFieldTypes";

export type InferredFieldDisplayStatus = "inferred_unconfirmed" | "confirmed" | "corrected";

const KIND_LABELS: Record<InferredContextFieldKind, string> = {
  objective: "Objectives",
  milestone: "Milestones",
  decision: "Decisions",
  risk: "Risks",
  capability: "Capabilities",
  candidate_action: "Candidate actions",
};

const DISPLAY_STATUS_LABELS: Record<InferredFieldDisplayStatus, string> = {
  inferred_unconfirmed: "Inferred -- unconfirmed",
  confirmed: "Confirmed",
  corrected: "Corrected",
};

/** Stable, deterministic grouping/render order -- matches ProjectContext's own field order (project-domain.md section 8). */
export const INFERRED_CONTEXT_FIELD_KIND_ORDER: readonly InferredContextFieldKind[] = [
  "objective",
  "milestone",
  "decision",
  "risk",
  "capability",
  "candidate_action",
];

export function inferredFieldKindLabel(kind: InferredContextFieldKind): string {
  return KIND_LABELS[kind];
}

export function inferredFieldDisplayStatusLabel(status: InferredFieldDisplayStatus): string {
  return DISPLAY_STATUS_LABELS[status];
}

/**
 * Returns null for a field this UI never shows by default: `user_rejected`,
 * `superseded`, or the pre-correction original row (`status:
 * "user_corrected"`, still `source: "model"`) -- ADR-0009 Q1/Q5 and the
 * "never shown as user content" rule.
 */
export function inferredFieldDisplayStatus(field: InferredProjectContextField): InferredFieldDisplayStatus | null {
  if (field.status === "proposed") return "inferred_unconfirmed";
  if (field.status === "user_confirmed") {
    return field.source === "user" && field.supersedesId ? "corrected" : "confirmed";
  }
  return null;
}

export function isVisibleByDefault(field: InferredProjectContextField): boolean {
  return inferredFieldDisplayStatus(field) !== null;
}

/** Only a still-`proposed` field can be resolved -- resolve_inferred_context_field raises FIELD_NOT_PROPOSED for every other status. */
export function isActionable(field: InferredProjectContextField): boolean {
  return field.status === "proposed";
}

/** Groups the default-visible subset by kind, newest first within each kind, in a stable kind order. */
export function groupVisibleInferredFields(
  fields: readonly InferredProjectContextField[],
): ReadonlyArray<{ readonly kind: InferredContextFieldKind; readonly fields: readonly InferredProjectContextField[] }> {
  const grouped = new Map<InferredContextFieldKind, InferredProjectContextField[]>();
  for (const field of fields) {
    if (!isVisibleByDefault(field)) continue;
    const bucket = grouped.get(field.kind);
    if (bucket) bucket.push(field);
    else grouped.set(field.kind, [field]);
  }
  const result: Array<{ kind: InferredContextFieldKind; fields: readonly InferredProjectContextField[] }> = [];
  for (const kind of INFERRED_CONTEXT_FIELD_KIND_ORDER) {
    const bucket = grouped.get(kind);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    result.push({ kind, fields: bucket });
  }
  return result;
}

function asRecord(content: InferredFieldContent): Record<string, unknown> {
  return content as unknown as Record<string, unknown>;
}

const PRIMARY_TEXT_FIELD: Record<InferredContextFieldKind, "summary" | "title"> = {
  objective: "summary",
  milestone: "title",
  decision: "title",
  risk: "summary",
  capability: "title",
  candidate_action: "summary",
};

export function inferredFieldPrimaryText(kind: InferredContextFieldKind, content: InferredFieldContent): string {
  const value = asRecord(content)[PRIMARY_TEXT_FIELD[kind]];
  return typeof value === "string" ? value : "";
}

/** A short, secondary line for the card -- status/severity, never a second source of truth (the full content is always shown via the correction form's own pre-filled fields). */
export function inferredFieldSecondaryText(kind: InferredContextFieldKind, content: InferredFieldContent): string | undefined {
  const record = asRecord(content);
  if (kind === "candidate_action") return undefined;
  const key = kind === "risk" ? "severity" : "status";
  const value = record[key];
  return typeof value === "string" ? `${kind === "risk" ? "Severity" : "Status"}: ${value}` : undefined;
}

// ---------------------------------------------------------------------------
// Correction-form field schema -- declared once, shared by the form and by
// content <-> form-values conversion. Mirrors
// inferredProjectContextFieldTypes.ts's per-kind content shape exactly; no
// field exists here that the type doesn't already have.
// ---------------------------------------------------------------------------

export interface InferredFieldFormFieldSchema {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly input: "text" | "textarea" | "select" | "number" | "date";
  readonly options?: readonly string[];
}

export const INFERRED_FIELD_FORM_SCHEMAS: Record<InferredContextFieldKind, readonly InferredFieldFormFieldSchema[]> = {
  objective: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "status", label: "Status", required: true, input: "select", options: ["active", "achieved", "abandoned", "superseded"] },
    { name: "since", label: "Since (date/time)", required: false, input: "date" },
  ],
  milestone: [
    { name: "title", label: "Title", required: true, input: "text" },
    { name: "status", label: "Status", required: true, input: "select", options: ["planned", "active", "completed", "deferred", "blocked"] },
    { name: "order", label: "Order", required: false, input: "number" },
    { name: "completedAt", label: "Completed at (date/time)", required: false, input: "date" },
  ],
  decision: [
    { name: "title", label: "Title", required: true, input: "text" },
    { name: "status", label: "Status", required: true, input: "select", options: ["accepted", "proposed", "superseded", "rejected"] },
    { name: "decidedAt", label: "Decided at (date/time)", required: false, input: "date" },
  ],
  risk: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "severity", label: "Severity", required: true, input: "select", options: ["low", "medium", "high"] },
    { name: "notes", label: "Notes", required: false, input: "textarea" },
  ],
  capability: [
    { name: "title", label: "Title", required: true, input: "text" },
    {
      name: "status",
      label: "Status",
      required: true,
      input: "select",
      options: ["implemented", "partially_implemented", "planned", "deferred", "unsupported"],
    },
    { name: "notes", label: "Notes", required: false, input: "textarea" },
  ],
  candidate_action: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "rationale", label: "Rationale", required: false, input: "textarea" },
  ],
};

/** Pre-fills a form's string values from an existing content payload -- e.g. for a `number` field, `String(3)` = `"3"`. */
export function inferredFieldFormInitialValues(kind: InferredContextFieldKind, content: InferredFieldContent): Record<string, string> {
  const record = asRecord(content);
  const values: Record<string, string> = {};
  for (const field of INFERRED_FIELD_FORM_SCHEMAS[kind]) {
    const raw = record[field.name];
    values[field.name] = raw === undefined || raw === null ? "" : String(raw);
  }
  return values;
}

/**
 * Converts raw form string values into an untyped content candidate. Never
 * itself decides validity -- an empty field is simply omitted (not coerced
 * to a fabricated value) so the canonical validator
 * (`validateInferredFieldContent`) produces the real, typed error for a
 * missing required field, exactly as it would for any other caller.
 */
export function buildInferredFieldContentFromForm(kind: InferredContextFieldKind, values: Readonly<Record<string, string>>): unknown {
  const result: Record<string, unknown> = {};
  for (const field of INFERRED_FIELD_FORM_SCHEMAS[kind]) {
    const raw = (values[field.name] ?? "").trim();
    if (!raw) continue;
    if (field.input === "number") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) result[field.name] = parsed;
    } else {
      result[field.name] = raw;
    }
  }
  return result;
}
