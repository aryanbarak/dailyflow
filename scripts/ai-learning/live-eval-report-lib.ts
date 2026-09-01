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

import { readFileSync } from 'node:fs'
import type {
  LiveLearningEventRecord,
  LiveRoutingEvalReport,
} from '../../agent/worker/ai-learning/live-routing-comparison'
import { LIVE_ROUTING_SCORED_FIELDS } from '../../agent/worker/ai-learning/live-routing-comparison'

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

export function parseJsonl(text: string): unknown[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
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

export function loadEventsFile(path: string): LiveLearningEventRecord[] {
  const rows = parseJsonl(readFileSync(path, 'utf8'))
  const records: LiveLearningEventRecord[] = []
  for (const row of rows) {
    const record = toLiveLearningEventRecord(row)
    if (record) records.push(record)
  }
  return records
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
    throw new Error('Usage: vite-node scripts/ai-learning/live-eval-report.ts <events.jsonl> [--json]')
  }
  return { eventsPath: positional[0], json }
}
