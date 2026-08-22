// Task 45c, ADR-0017: builds the batch-import approval preview from the
// parser's output ONLY -- no re-parsing, no I/O, no Supabase, no DOM. Same
// discipline as shared/financeDirection.ts and shared/bankStatementParser.ts.
//
// Deliberately AGGREGATE-ONLY (row count, date range, sums, currency,
// quarantined rows, duplicate count) -- no individual transaction's date,
// amount, or description is exposed here. ADR-0017 frames a batch import as
// ONE proposal, not N reviewable rows; this is a genuine simplification
// over the old BankImportTool's per-row checkbox review, not an oversight.
//
// The caller supplies `duplicateHashes` (from a fresh, Worker-side DB
// lookup -- see agent/worker/flow-write-policy.ts's checkDuplicateRows).
// This module never decides what counts as a duplicate; it only reports
// the consequence of that decision in the preview's shape.

import type { BankStatementParseResult, ParsedBankRow } from './bankStatementParser';

export interface BatchImportDateRange {
  readonly start: string;
  readonly end: string;
}

export interface BatchImportSums {
  readonly income: number;
  readonly expense: number;
}

export interface BatchImportQuarantinedSummary {
  readonly lineNumber: number;
  readonly reasonCode: string;
  readonly reason: string;
}

export interface BatchImportPreview {
  /** Mirrors the parser's own verdict -- 'blocked_over_threshold'/'blocked_structural' mean nothing is importable. */
  readonly verdict: BankStatementParseResult['verdict'];
  readonly structuralError?: string;
  /** Rows that parsed successfully AND are not duplicates -- the count that would actually be inserted on commit. */
  readonly importableCount: number;
  readonly duplicateCount: number;
  readonly quarantinedCount: number;
  readonly quarantined: readonly BatchImportQuarantinedSummary[];
  readonly totalDataRows: number;
  readonly quarantineRatio: number;
  /** null when there are zero importable rows (nothing to range over). */
  readonly dateRange: BatchImportDateRange | null;
  readonly sums: BatchImportSums;
  /** null when there are zero importable rows, or the importable rows mix currencies (never silently pick one). */
  readonly currency: string | null;
  readonly mixedCurrency: boolean;
}

function importableRowsOf(parseResult: BankStatementParseResult, duplicateHashes: ReadonlySet<string>): ParsedBankRow[] {
  return parseResult.rows.filter((row) => !duplicateHashes.has(row.rowHash));
}

/**
 * The rows that would actually be sent to executeBatchFinanceImport on
 * commit -- exported so the commit path and the preview path derive
 * "importable" identically, never two independently-maintained filters
 * that could silently disagree.
 */
export function selectImportableRows(parseResult: BankStatementParseResult, duplicateHashes: ReadonlySet<string>): ParsedBankRow[] {
  return importableRowsOf(parseResult, duplicateHashes);
}

export function buildBatchImportPreview(
  parseResult: BankStatementParseResult,
  duplicateHashes: ReadonlySet<string>,
): BatchImportPreview {
  if (parseResult.verdict !== 'ok') {
    return {
      verdict: parseResult.verdict,
      structuralError: parseResult.structuralError,
      importableCount: 0,
      duplicateCount: 0,
      quarantinedCount: parseResult.quarantined.length,
      quarantined: parseResult.quarantined.map((q) => ({ lineNumber: q.lineNumber, reasonCode: q.reasonCode, reason: q.reason })),
      totalDataRows: parseResult.totalDataRows,
      quarantineRatio: parseResult.quarantineRatio,
      dateRange: null,
      sums: { income: 0, expense: 0 },
      currency: null,
      mixedCurrency: false,
    };
  }

  const importable = importableRowsOf(parseResult, duplicateHashes);
  const duplicateCount = parseResult.rows.length - importable.length;

  let dateRange: BatchImportDateRange | null = null;
  let income = 0;
  let expense = 0;
  const currencies = new Set<string>();

  for (const row of importable) {
    if (!dateRange) {
      dateRange = { start: row.date, end: row.date };
    } else {
      if (row.date < dateRange.start) dateRange = { ...dateRange, start: row.date };
      if (row.date > dateRange.end) dateRange = { ...dateRange, end: row.date };
    }
    if (row.direction === 'income') income += row.amount;
    else expense += row.amount;
    currencies.add(row.currency);
  }

  const mixedCurrency = currencies.size > 1;

  return {
    verdict: 'ok',
    importableCount: importable.length,
    duplicateCount,
    quarantinedCount: parseResult.quarantined.length,
    quarantined: parseResult.quarantined.map((q) => ({ lineNumber: q.lineNumber, reasonCode: q.reasonCode, reason: q.reason })),
    totalDataRows: parseResult.totalDataRows,
    quarantineRatio: parseResult.quarantineRatio,
    dateRange,
    // Rounding to 2dp defensively -- floating point summation of many rows
    // can drift a fraction of a cent; this is a DISPLAY preview, never the
    // value actually inserted (executeBatchFinanceImport sums nothing --
    // it persists each row's own already-parsed amount unchanged).
    sums: { income: Math.round(income * 100) / 100, expense: Math.round(expense * 100) / 100 },
    currency: mixedCurrency ? null : (currencies.values().next().value ?? null),
    mixedCurrency,
  };
}
