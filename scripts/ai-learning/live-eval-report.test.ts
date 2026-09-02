#!/usr/bin/env node
// ALF-1B: focused tests for live-eval-report.ts's own glue logic (JSONL
// row parsing/normalization, report text formatting). The actual
// comparison logic this script consumes is exhaustively tested under
// vitest at agent/worker/ai-learning/live-routing-comparison.test.ts
// (scripts/** is excluded from the vitest project, matching
// scripts/ai-learning/score-eval.mjs's own established split -- see
// vite.config.ts's own `exclude` list) -- this file only needs to prove
// the CLI-specific wrapper logic, not re-prove the comparison semantics.
//
// Run manually:
//   npx vite-node scripts/ai-learning/live-eval-report.test.ts

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatLiveEvalReport,
  loadEventsFile,
  LiveEvalReportError,
  parseArgs,
  parseJsonl,
  toLiveLearningEventRecord,
} from './live-eval-report-lib'
import { compareLiveRoutingEvents } from '../../agent/worker/ai-learning/live-routing-comparison'

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed += 1
    console.log(`  ok - ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  FAIL - ${name}`)
    console.error(error instanceof Error ? error.message : String(error))
  }
}

test('parseJsonl skips blank lines and parses each remaining line as JSON, tagged with its 1-based source line number', () => {
  const rows = parseJsonl('{"a":1}\n\n  \n{"a":2}\n')
  assert.deepEqual(rows, [
    { line: 1, value: { a: 1 } },
    { line: 4, value: { a: 2 } },
  ])
})

test('parseJsonl throws a fixed LiveEvalReportError (never JSON.parse\'s own message) for an unparsable line', () => {
  assert.throws(
    () => parseJsonl('{"a":1}\nnot json\n'),
    (error: unknown) => {
      const e = error as LiveEvalReportError
      assert.ok(e instanceof LiveEvalReportError)
      assert.equal(e.code, 'MALFORMED_JSON_LINE')
      assert.equal(e.line, 2)
      return true
    },
  )
})

test('a secret marker inside an unparsable JSON line can never appear in the thrown error message', () => {
  const secretMarker = 'SECRET_MARKER_DO_NOT_LEAK'
  assert.throws(
    () => parseJsonl(`{"a":1}\nnot json but contains ${secretMarker}\n`),
    (error: unknown) => {
      const e = error as Error
      assert.ok(e instanceof Error)
      assert.equal(e.message.includes(secretMarker), false)
      return true
    },
  )
})

test('parseArgs throws a fixed USAGE LiveEvalReportError (never a free-text Error) when no path is given', () => {
  assert.throws(
    () => parseArgs([]),
    (error: unknown) => {
      const e = error as LiveEvalReportError
      assert.ok(e instanceof LiveEvalReportError)
      assert.equal(e.code, 'USAGE')
      return true
    },
  )
})

test('toLiveLearningEventRecord maps a well-formed snake_case ledger row to the camelCase record shape', () => {
  const record = toLiveLearningEventRecord({
    id: 'evt-1',
    user_id: 'user-1',
    source_message_id: 'msg-1',
    correlation_id: 'corr-1',
    learning_task: 'intent_routing_v1',
    schema_version: 'intent-routing-v1',
    event_kind: 'production_label',
    producer_type: 'deterministic_policy',
    label_confidence: 'validated',
    provider_id: null,
    model_id: null,
    model_version: null,
    source_hash: 'hash-1',
    payload: { schemaVersion: 'intent-routing-v1' },
  })
  assert.ok(record)
  assert.equal(record!.userId, 'user-1')
  assert.equal(record!.sourceMessageId, 'msg-1')
  assert.equal(record!.providerId, null)
  assert.equal(record!.producerType, 'deterministic_policy')
  assert.equal(record!.labelConfidence, 'validated')
})

test('toLiveLearningEventRecord returns null (never throws) for a row missing a required field', () => {
  assert.equal(toLiveLearningEventRecord({ id: 'evt-1' }), null)
  assert.equal(toLiveLearningEventRecord(null), null)
  assert.equal(toLiveLearningEventRecord('not an object'), null)
  assert.equal(toLiveLearningEventRecord({
    id: 'evt-1', user_id: 'u', correlation_id: 'c', learning_task: 't', schema_version: 's', event_kind: 'production_label',
    producer_type: 'deterministic_policy', payload: 'not an object',
  }), null)
  // Missing producer_type (ALF-1B correction 2, item 1) -- required on
  // every row, regardless of event_kind.
  assert.equal(toLiveLearningEventRecord({
    id: 'evt-1', user_id: 'u', source_message_id: 'msg-1', correlation_id: 'c', learning_task: 't', schema_version: 's',
    event_kind: 'production_label', payload: {},
  }), null)
})

test('toLiveLearningEventRecord normalizes a missing/empty optional column to null, not an empty string (for an event_kind ALF-1B does not require sourceMessageId on)', () => {
  const record = toLiveLearningEventRecord({
    id: 'evt-1', user_id: 'u', correlation_id: 'c', learning_task: 't', schema_version: 's', event_kind: 'turn_observed',
    producer_type: 'deterministic_policy', source_message_id: '', provider_id: '', model_id: undefined, model_version: null, source_hash: null,
    payload: {},
  })
  assert.ok(record)
  assert.equal(record!.sourceMessageId, null)
  assert.equal(record!.providerId, null)
  assert.equal(record!.modelId, null)
})

// ALF-1B correction 2, item 3: unlike 'turn_observed' above, a
// production_label/shadow_prediction row with an EMPTY (not just missing)
// source_message_id must fail closed, not normalize to null and proceed.
test('toLiveLearningEventRecord rejects a production_label/shadow_prediction row with an EMPTY source_message_id', () => {
  assert.equal(toLiveLearningEventRecord({
    id: 'evt-1', user_id: 'u', correlation_id: 'c', learning_task: 't', schema_version: 's', event_kind: 'production_label',
    producer_type: 'deterministic_policy', source_message_id: '', payload: {},
  }), null)
  assert.equal(toLiveLearningEventRecord({
    id: 'evt-1', user_id: 'u', correlation_id: 'c', learning_task: 't', schema_version: 's', event_kind: 'shadow_prediction',
    producer_type: 'shadow_model', source_message_id: '', payload: {},
  }), null)
})

test('formatLiveEvalReport explicitly states language and requiresApproval as masked, never silently omitted', () => {
  const report = compareLiveRoutingEvents([])
  const text = formatLiveEvalReport(report)
  assert.match(text, /language: masked/)
  assert.match(text, /requiresApproval: masked/)
})

test('formatLiveEvalReport never prints a raw message -- the report has no such field to print', () => {
  const report = compareLiveRoutingEvents([])
  const text = formatLiveEvalReport(report)
  assert.equal(text.includes('rawMessage'), false)
  assert.equal(text.includes('message'), false)
})

// ALF-1B correction 1, item 4: loadEventsFile is fail-closed -- a single
// malformed row aborts the WHOLE report (never silently dropped, which
// could corrupt evaluation metrics with no visible signal).
function withTempEventsFile(contents: string, fn: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'alf1b-live-eval-'))
  const path = join(dir, 'events.jsonl')
  writeFileSync(path, contents, 'utf8')
  try {
    fn(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('loadEventsFile aborts the whole report with a fixed MALFORMED_EVENT_ROW error when any row cannot be normalized', () => {
  withTempEventsFile('{"id":"evt-1","user_id":"u","source_message_id":"msg-1","correlation_id":"c","learning_task":"t","schema_version":"s","event_kind":"production_label","producer_type":"deterministic_policy","payload":{}}\n{"id":"evt-2"}\n', (path) => {
    assert.throws(
      () => loadEventsFile(path),
      (error: unknown) => {
        const e = error as LiveEvalReportError
        assert.ok(e instanceof LiveEvalReportError)
        assert.equal(e.code, 'MALFORMED_EVENT_ROW')
        assert.equal(e.line, 2)
        return true
      },
    )
  })
})

test('loadEventsFile aborts with a fixed MALFORMED_JSON_LINE error, never echoing a secret marker in a bad line', () => {
  const secretMarker = 'SECRET_MARKER_DO_NOT_LEAK'
  withTempEventsFile(`{"id":"evt-1","user_id":"u","source_message_id":"msg-1","correlation_id":"c","learning_task":"t","schema_version":"s","event_kind":"production_label","producer_type":"deterministic_policy","payload":{}}\nnot json ${secretMarker}\n`, (path) => {
    assert.throws(
      () => loadEventsFile(path),
      (error: unknown) => {
        const e = error as Error
        assert.ok(e instanceof LiveEvalReportError)
        assert.equal((e as LiveEvalReportError).code, 'MALFORMED_JSON_LINE')
        assert.equal(e.message.includes(secretMarker), false)
        return true
      },
    )
  })
})

test('loadEventsFile succeeds and returns every row when the whole file is well-formed', () => {
  withTempEventsFile('{"id":"evt-1","user_id":"u","source_message_id":"msg-1","correlation_id":"c","learning_task":"t","schema_version":"s","event_kind":"production_label","producer_type":"deterministic_policy","payload":{}}\n', (path) => {
    const records = loadEventsFile(path)
    assert.equal(records.length, 1)
    assert.equal(records[0].id, 'evt-1')
    assert.equal(records[0].producerType, 'deterministic_policy')
  })
})

test('loadEventsFile rejects a production_label row missing source_message_id (ALF-1B correction 2, item 3) -- fails closed, never silently proceeds', () => {
  withTempEventsFile('{"id":"evt-1","user_id":"u","correlation_id":"c","learning_task":"t","schema_version":"s","event_kind":"production_label","producer_type":"deterministic_policy","payload":{}}\n', (path) => {
    assert.throws(
      () => loadEventsFile(path),
      (error: unknown) => {
        const e = error as LiveEvalReportError
        assert.ok(e instanceof LiveEvalReportError)
        assert.equal(e.code, 'MALFORMED_EVENT_ROW')
        assert.equal(e.line, 1)
        return true
      },
    )
  })
})

test('loadEventsFile rejects a row missing producer_type (ALF-1B correction 2, item 1)', () => {
  withTempEventsFile('{"id":"evt-1","user_id":"u","source_message_id":"msg-1","correlation_id":"c","learning_task":"t","schema_version":"s","event_kind":"production_label","payload":{}}\n', (path) => {
    assert.throws(
      () => loadEventsFile(path),
      (error: unknown) => {
        const e = error as LiveEvalReportError
        assert.ok(e instanceof LiveEvalReportError)
        assert.equal(e.code, 'MALFORMED_EVENT_ROW')
        return true
      },
    )
  })
})

test('toLiveLearningEventRecord normalizes a missing label_confidence to null, and carries through a present one verbatim', () => {
  const withoutConfidence = toLiveLearningEventRecord({
    id: 'evt-1', user_id: 'u', source_message_id: 'msg-1', correlation_id: 'c', learning_task: 't', schema_version: 's',
    event_kind: 'production_label', producer_type: 'deterministic_policy', payload: {},
  })
  assert.ok(withoutConfidence)
  assert.equal(withoutConfidence!.labelConfidence, null)

  const withConfidence = toLiveLearningEventRecord({
    id: 'evt-2', user_id: 'u', source_message_id: 'msg-1', correlation_id: 'c', learning_task: 't', schema_version: 's',
    event_kind: 'production_label', producer_type: 'deterministic_policy', label_confidence: 'validated', payload: {},
  })
  assert.ok(withConfidence)
  assert.equal(withConfidence!.labelConfidence, 'validated')
})

test('loadEventsFile throws a fixed FILE_READ_FAILED error for a missing file', () => {
  assert.throws(
    () => loadEventsFile(join(tmpdir(), 'alf1b-live-eval-does-not-exist', 'nope.jsonl')),
    (error: unknown) => {
      const e = error as LiveEvalReportError
      assert.ok(e instanceof LiveEvalReportError)
      assert.equal(e.code, 'FILE_READ_FAILED')
      return true
    },
  )
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
