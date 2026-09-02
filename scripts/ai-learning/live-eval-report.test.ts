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
})

test('toLiveLearningEventRecord returns null (never throws) for a row missing a required field', () => {
  assert.equal(toLiveLearningEventRecord({ id: 'evt-1' }), null)
  assert.equal(toLiveLearningEventRecord(null), null)
  assert.equal(toLiveLearningEventRecord('not an object'), null)
  assert.equal(toLiveLearningEventRecord({
    id: 'evt-1', user_id: 'u', correlation_id: 'c', learning_task: 't', schema_version: 's', event_kind: 'production_label',
    payload: 'not an object',
  }), null)
})

test('toLiveLearningEventRecord normalizes a missing/empty optional column to null, not an empty string', () => {
  const record = toLiveLearningEventRecord({
    id: 'evt-1', user_id: 'u', correlation_id: 'c', learning_task: 't', schema_version: 's', event_kind: 'shadow_prediction',
    source_message_id: '', provider_id: '', model_id: undefined, model_version: null, source_hash: null,
    payload: {},
  })
  assert.ok(record)
  assert.equal(record!.sourceMessageId, null)
  assert.equal(record!.providerId, null)
  assert.equal(record!.modelId, null)
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
  withTempEventsFile('{"id":"evt-1","user_id":"u","correlation_id":"c","learning_task":"t","schema_version":"s","event_kind":"production_label","payload":{}}\n{"id":"evt-2"}\n', (path) => {
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
  withTempEventsFile(`{"id":"evt-1","user_id":"u","correlation_id":"c","learning_task":"t","schema_version":"s","event_kind":"production_label","payload":{}}\nnot json ${secretMarker}\n`, (path) => {
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
  withTempEventsFile('{"id":"evt-1","user_id":"u","correlation_id":"c","learning_task":"t","schema_version":"s","event_kind":"production_label","payload":{}}\n', (path) => {
    const records = loadEventsFile(path)
    assert.equal(records.length, 1)
    assert.equal(records[0].id, 'evt-1')
  })
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
