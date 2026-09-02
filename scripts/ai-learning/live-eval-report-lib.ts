// ALF-1B: pure, side-effect-free helpers for live-eval-report.ts (the CLI
// entry point). Split into its own module SPECIFICALLY so it can be
// imported by live-eval-report.test.ts without also triggering the CLI's
// own main()/process.argv handling -- vite-node does not set
// process.argv[1] to the executed script's own path (it points at
// vite-node's own entry instead), so the usual
// `import.meta.url === pathToFileURL(process.argv[1]).href` "only run
// main() when executed directly" guard does not work under vite-node.
// Splitting the CLI entry (unconditional `main()` call, matching
// scripts/provider-contract-smoke.ts's own precedent) from this
// importable, side-effect-free library module sidesteps that entirely.
//
// NO NETWORK CALL. NO SUPABASE CLIENT. NO CREDENTIALS. See
// live-eval-report.ts's own header for the full privacy/usage contract
// this module's functions serve.
//
// FIXED BOUNDED ERROR MESSAGES ONLY (ALF-1B correction 1, item 2 + 4).
// Every failure this module can raise is a LiveEvalReportError carrying
// one of a small closed set of reason codes, plus -- for the two cases
// where it is useful -- a bounded 1-based line number (a position in the
// file, never its content). NOTHING derived from row/line CONTENT is ever
// attached to an error: not JSON.parse's own message (which can echo a
// fragment of the offending text), not the row's own fields, not any
// other exception's arbitrary `.message`. This is deliberately
// fail-closed for malformed input (see loadEventsFile below): a single
// bad row aborts the WHOLE report rather than being silently dropped,
// since silently dropping rows could corrupt evaluation metrics without
// any visible signal that data went missing.

import { readFileSync } from 'node:fs'
import type {
  LiveLearningEventRecord,
  LiveRoutingEvalReport,
} from '../../agent/worker/ai-learning/live-routing-comparison'
import { LIVE_ROUTING_SCORED_FIELDS } from '../../agent/worker/ai-learning/live-routing-comparison'

export type LiveEvalReportErrorCode =
  | 'USAGE'
  | 'FILE_READ_FAILED'
  | 'MALFORMED_JSON_LINE'
  | 'MALFORMED_EVENT_ROW'

function fixedErrorMessage(code: LiveEvalReportErrorCode, line: number | undefined): string {
  switch (code) {
    case 'USAGE':
      return 'Usage: vite-node scripts/ai-learning/live-eval-report.ts <events.jsonl> [--json]'
    case 'FILE_READ_FAILED':
      return 'events file could not be read'
    case 'MALFORMED_JSON_LINE':
      return line === undefined ? 'malformed JSON line in events file' : `malformed JSON on line ${line} of events file`
    case 'MALFORMED_EVENT_ROW':
      return line === undefined
        ? 'malformed ledger event row in events file'
        : `malformed ledger event row on line ${line} of events file`
  }
}

// A FIXED, bounded error type -- .message is always one of the templates
// above (optionally with a bounded line NUMBER interpolated, never row
// content). Never construct one with a message drawn from another
// exception or from parsed data.
export class LiveEvalReportError extends Error {
  readonly code: LiveEvalReportErrorCode
  readonly line?: number

  constructor(code: LiveEvalReportErrorCode, line?: number) {
    super(fixedErrorMessage(code, line))
    this.name = 'LiveEvalReportError'
    this.code = code
    this.line = line
  }
}

interface RawLedgerRow {
  id?: unknown
  user_id?: unknown
  source_message_id?: unknown
  correlation_id?: unknown
  learning_task?: unknown
  schema_version?: unknown
  event_kind?: unknown
  provider_id?: unknown
  model_id?: unknown
  model_version?: unknown
  source_hash?: unknown
  payload?: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export interface ParsedJsonlLine {
  // 1-based position in the source file -- used only to name WHERE a
  // later normalization failure occurred, never to carry content.
  readonly line: number
  readonly value: unknown
}

// Throws LiveEvalReportError('MALFORMED_JSON_LINE', line) for an
// unparsable line -- NEVER JSON.parse's own thrown error (its message can
// include a fragment of the offending text, which this module's fixed-
// bounded-error-message contract forbids).
export function parseJsonl(text: string): ParsedJsonlLine[] {
  const rawLines = text.split('\n')
  const parsed: ParsedJsonlLine[] = []
  for (let i = 0; i < rawLines.length; i += 1) {
    const trimmed = rawLines[i].trim()
    if (trimmed.length === 0) continue
    let value: unknown
    try {
      value = JSON.parse(trimmed)
    } catch {
      throw new LiveEvalReportError('MALFORMED_JSON_LINE', i + 1)
    }
    parsed.push({ line: i + 1, value })
  }
  return parsed
}

// Never throws for a malformed individual row -- returns null, and the
// caller (loadEventsFile) simply excludes it. A whole-file read/parse
// failure (missing file, invalid JSON on some line) DOES throw, since
// that is a caller-fixable input error, not ledger-data noise to tolerate.
export function toLiveLearningEventRecord(row: unknown): LiveLearningEventRecord | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const r = row as RawLedgerRow
  if (
    !isNonEmptyString(r.id) ||
    !isNonEmptyString(r.user_id) ||
    !isNonEmptyString(r.correlation_id) ||
    !isNonEmptyString(r.learning_task) ||
    !isNonEmptyString(r.schema_version) ||
    !isNonEmptyString(r.event_kind)
  ) {
    return null
  }
  if (!r.payload || typeof r.payload !== 'object' || Array.isArray(r.payload)) return null

  return {
    id: r.id,
    userId: r.user_id,
    sourceMessageId: isNonEmptyString(r.source_message_id) ? r.source_message_id : null,
    correlationId: r.correlation_id,
    learningTask: r.learning_task,
    schemaVersion: r.schema_version,
    eventKind: r.event_kind,
    providerId: isNonEmptyString(r.provider_id) ? r.provider_id : null,
    modelId: isNonEmptyString(r.model_id) ? r.model_id : null,
    modelVersion: isNonEmptyString(r.model_version) ? r.model_version : null,
    sourceHash: isNonEmptyString(r.source_hash) ? r.source_hash : null,
    payload: r.payload as Record<string, unknown>,
  }
}

// Fail-closed (ALF-1B correction 1, item 4): a single row that cannot be
// normalized aborts the WHOLE report with a fixed, bounded
// MALFORMED_EVENT_ROW error (code + line number only) rather than being
// silently dropped -- silently dropping rows could corrupt evaluation
// metrics (a smaller-than-real denominator) with no visible signal that
// data went missing. toLiveLearningEventRecord itself stays a pure,
// never-throwing predicate (row shape validity in isolation, still used
// directly by tests); this function is the fail-closed boundary around it.
export function loadEventsFile(path: string): LiveLearningEventRecord[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new LiveEvalReportError('FILE_READ_FAILED')
  }
  const parsedLines = parseJsonl(text)
  return parsedLines.map(({ line, value }) => {
    const record = toLiveLearningEventRecord(value)
    if (!record) throw new LiveEvalReportError('MALFORMED_EVENT_ROW', line)
    return record
  })
}

// Human-readable report text. Explicitly states which fields are masked
// (never silently omitted, per this slice's own requirement) rather than
// leaving their absence from fieldAccuracy to be discovered by inference.
export function formatLiveEvalReport(report: LiveRoutingEvalReport): string {
  const lines: string[] = [
    `schemaVersion: ${report.schemaVersion}`,
    `totalProductionLabels: ${report.totalProductionLabels}`,
    `totalShadowPredictions: ${report.totalShadowPredictions}`,
    `eligiblePairs: ${report.eligiblePairs}`,
    `missingProductionSide: ${report.missingProductionSide}`,
    `missingShadowSide: ${report.missingShadowSide}`,
    `ambiguousProductionGroups: ${report.ambiguousProductionGroups}`,
    `ambiguousShadowModelSlices: ${report.ambiguousShadowModelSlices}`,
    `invalidProductionLabelCount: ${report.invalidProductionLabelCount}`,
    `invalidShadowPredictionCount: ${report.invalidShadowPredictionCount}`,
    `invalidOrIncompatiblePairs: ${report.invalidOrIncompatiblePairs}`,
    `exactRoutingAccuracy: ${report.exactRoutingAccuracy}`,
  ]
  for (const field of LIVE_ROUTING_SCORED_FIELDS) {
    lines.push(`${field}Accuracy: ${report.fieldAccuracy[field]}`)
  }
  for (const field of report.maskedFields) {
    lines.push(`${field}: masked`)
  }
  lines.push(`note: ${report.maskedFieldNote}`)
  return lines.join('\n')
}

export function parseArgs(argv: string[]): { eventsPath: string; json: boolean } {
  const json = argv.includes('--json')
  const positional = argv.filter((arg) => arg !== '--json')
  if (positional.length < 1) {
    throw new LiveEvalReportError('USAGE')
  }
  return { eventsPath: positional[0], json }
}
