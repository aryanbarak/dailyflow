// SmartFlow -- Personal Memory Layer (ADR-0010), confirm/correct/reject/
// delete UI (task 6; docs/architecture/notes/personal-memory-review-ui-
// design-note.md).
//
// Pure, deterministic display/formatting helpers over PersonalMemoryRecord
// -- no I/O, no fetching, no mutation. Kept separate from the React
// component so the disambiguation rule below is unit-testable without
// rendering anything, mirroring inferredContextFieldPresentation.ts's own
// separation exactly, one dimension over.
//
// resolve_personal_memory_record's own transition rules (see the migration)
// make `status` alone ambiguous for a "confirmed" row: a plain confirm
// keeps source="model" on the SAME row, while a correction inserts a NEW
// source="user" row that also carries status="user_confirmed". This module
// disambiguates on (status, source, supersedesId), never on status alone --
// see the design note's disambiguation table.

import type {
  PersonalMemoryContent,
  PersonalMemoryRecord,
  PersonalMemoryRecordKind,
} from "./personalMemoryRecordTypes";
import { PERSONAL_MEMORY_RECORD_KINDS } from "./personalMemoryRecordTypes";

export type PersonalMemoryDisplayStatus = "proposed" | "confirmed" | "corrected" | "rejected";

const KIND_LABELS: Record<PersonalMemoryRecordKind, string> = {
  preference: "Preferences",
  goal: "Goals",
  working_pattern: "Working patterns",
  commitment: "Commitments",
  personal_fact: "Personal facts",
  skill: "Skills",
};

const DISPLAY_STATUS_LABELS: Record<PersonalMemoryDisplayStatus, string> = {
  proposed: "Proposed",
  confirmed: "Confirmed",
  corrected: "Corrected",
  rejected: "Rejected",
};

/**
 * Extra plain-language line shown under the status label -- makes an
 * otherwise-invisible guarantee visible to the person looking at the
 * record, per the design note: Q5's zero-consumption rule for `proposed`,
 * and Q1's "rejection still suppresses" rule for `rejected`.
 */
const DISPLAY_STATUS_HELP_TEXT: Partial<Record<PersonalMemoryDisplayStatus, string>> = {
  proposed: "Not used anywhere until you confirm it.",
  rejected: "Still prevents this same fact from being suggested again.",
};

/** Stable, deterministic grouping/render order. */
export const PERSONAL_MEMORY_KIND_ORDER: readonly PersonalMemoryRecordKind[] = PERSONAL_MEMORY_RECORD_KINDS;

export function personalMemoryKindLabel(kind: PersonalMemoryRecordKind): string {
  return KIND_LABELS[kind];
}

export function personalMemoryDisplayStatusLabel(status: PersonalMemoryDisplayStatus): string {
  return DISPLAY_STATUS_LABELS[status];
}

export function personalMemoryDisplayStatusHelpText(status: PersonalMemoryDisplayStatus): string | undefined {
  return DISPLAY_STATUS_HELP_TEXT[status];
}

/**
 * Returns null for a record this UI never shows as its own list entry:
 * the pre-correction original (`status: "user_corrected"`, still `source:
 * "model"`) -- visible only via the correcting record's own "view
 * original" history affordance, never as user content -- or `superseded`
 * (unreachable in v1; no kind receives automatic supersession, per
 * ADR-0010 Implementation Notes, but the column's CHECK constraint still
 * allows the value for schema symmetry with ADR-0009, so this function
 * must not crash on it).
 */
export function personalMemoryRecordDisplayStatus(record: PersonalMemoryRecord): PersonalMemoryDisplayStatus | null {
  if (record.status === "proposed") return "proposed";
  if (record.status === "user_confirmed") {
    return record.source === "user" && record.supersedesId ? "corrected" : "confirmed";
  }
  if (record.status === "user_rejected") return "rejected";
  return null;
}

/** Only a still-`proposed` record can be resolved -- resolve_personal_memory_record raises RECORD_NOT_PROPOSED for every other status. */
export function isPersonalMemoryRecordActionable(record: PersonalMemoryRecord): boolean {
  return record.status === "proposed";
}

export interface PersonalMemoryDisplayEntry {
  readonly record: PersonalMemoryRecord;
  readonly displayStatus: PersonalMemoryDisplayStatus;
  /** Present only for a "corrected" entry -- the pre-correction original, for the history affordance. Never rendered as its own list entry. */
  readonly originalRecord?: PersonalMemoryRecord;
}

/**
 * Groups the visible subset by kind, newest first within each kind, in a
 * stable kind order. Rejected records are included only when
 * `showRejected` is true (default-hidden per the design note); every other
 * visible status is always included regardless of this flag.
 */
export function groupVisiblePersonalMemoryRecords(
  records: readonly PersonalMemoryRecord[],
  options: { readonly showRejected?: boolean } = {},
): ReadonlyArray<{ readonly kind: PersonalMemoryRecordKind; readonly entries: readonly PersonalMemoryDisplayEntry[] }> {
  const showRejected = options.showRejected ?? false;
  const byId = new Map<string, PersonalMemoryRecord>();
  for (const record of records) byId.set(record.id, record);

  const grouped = new Map<PersonalMemoryRecordKind, PersonalMemoryDisplayEntry[]>();
  for (const record of records) {
    const displayStatus = personalMemoryRecordDisplayStatus(record);
    if (!displayStatus) continue;
    if (displayStatus === "rejected" && !showRejected) continue;

    const entry: PersonalMemoryDisplayEntry =
      displayStatus === "corrected" && record.supersedesId
        ? { record, displayStatus, originalRecord: byId.get(record.supersedesId) }
        : { record, displayStatus };

    const bucket = grouped.get(record.kind);
    if (bucket) bucket.push(entry);
    else grouped.set(record.kind, [entry]);
  }

  const result: Array<{ kind: PersonalMemoryRecordKind; entries: readonly PersonalMemoryDisplayEntry[] }> = [];
  for (const kind of PERSONAL_MEMORY_KIND_ORDER) {
    const bucket = grouped.get(kind);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt));
    result.push({ kind, entries: bucket });
  }
  return result;
}

function asRecord(content: PersonalMemoryContent): Record<string, unknown> {
  return content as unknown as Record<string, unknown>;
}

/** Every kind shares `summary` as its primary field -- unlike the project layer's objective/risk "summary" vs. milestone/decision "title" split. */
export function personalMemoryRecordPrimaryText(content: PersonalMemoryContent): string {
  const value = asRecord(content).summary;
  return typeof value === "string" ? value : "";
}

const SECONDARY_FIELD: Record<PersonalMemoryRecordKind, { readonly name: string; readonly label: string }> = {
  preference: { name: "strength", label: "Strength" },
  goal: { name: "timeframe", label: "Timeframe" },
  working_pattern: { name: "frequency", label: "Frequency" },
  commitment: { name: "status", label: "Status" },
  personal_fact: { name: "category", label: "Category" },
  skill: { name: "level", label: "Level" },
};

/** A short, secondary line for the card -- never a second source of truth (the full content is always shown via the correction form's own pre-filled fields). */
export function personalMemoryRecordSecondaryText(kind: PersonalMemoryRecordKind, content: PersonalMemoryContent): string | undefined {
  const { name, label } = SECONDARY_FIELD[kind];
  const value = asRecord(content)[name];
  return typeof value === "string" ? `${label}: ${value}` : undefined;
}

// ---------------------------------------------------------------------------
// Correction-form field schema -- declared once, shared by the form and by
// content <-> form-values conversion. Mirrors
// personalMemoryRecordTypes.ts's per-kind content shape exactly; no field
// exists here that the type doesn't already have.
// ---------------------------------------------------------------------------

export interface PersonalMemoryFormFieldSchema {
  readonly name: string;
  readonly label: string;
  readonly required: boolean;
  readonly input: "text" | "select";
  readonly options?: readonly string[];
}

export const PERSONAL_MEMORY_FORM_SCHEMAS: Record<PersonalMemoryRecordKind, readonly PersonalMemoryFormFieldSchema[]> = {
  preference: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "strength", label: "Strength", required: false, input: "select", options: ["strong", "moderate", "mild"] },
  ],
  goal: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "timeframe", label: "Timeframe", required: false, input: "select", options: ["short_term", "long_term"] },
  ],
  working_pattern: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "frequency", label: "Frequency", required: false, input: "select", options: ["daily", "weekly", "occasional"] },
  ],
  commitment: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "status", label: "Status", required: true, input: "select", options: ["active", "completed", "abandoned"] },
  ],
  personal_fact: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "category", label: "Category", required: false, input: "select", options: ["identity", "work_status", "general"] },
  ],
  skill: [
    { name: "summary", label: "Summary", required: true, input: "text" },
    { name: "level", label: "Level", required: false, input: "select", options: ["beginner", "intermediate", "advanced"] },
  ],
};

/** Pre-fills a form's string values from an existing content payload. */
export function personalMemoryFormInitialValues(kind: PersonalMemoryRecordKind, content: PersonalMemoryContent): Record<string, string> {
  const record = asRecord(content);
  const values: Record<string, string> = {};
  for (const field of PERSONAL_MEMORY_FORM_SCHEMAS[kind]) {
    const raw = record[field.name];
    values[field.name] = typeof raw === "string" ? raw : "";
  }
  return values;
}

/**
 * Converts raw form string values into an untyped content candidate. Never
 * itself decides validity -- an empty field is simply omitted (not coerced
 * to a fabricated value) so the canonical validator
 * (`validatePersonalMemoryContent`) produces the real, typed error for a
 * missing required field, exactly as it would for any other caller.
 */
export function buildPersonalMemoryContentFromForm(kind: PersonalMemoryRecordKind, values: Readonly<Record<string, string>>): unknown {
  const result: Record<string, unknown> = {};
  for (const field of PERSONAL_MEMORY_FORM_SCHEMAS[kind]) {
    const raw = (values[field.name] ?? "").trim();
    if (raw) result[field.name] = raw;
  }
  return result;
}
