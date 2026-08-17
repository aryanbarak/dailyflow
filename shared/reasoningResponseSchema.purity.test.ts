import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildReasoningResponseSchema, SUPPORTED_INTENT_VALUES } from '../agent/worker/reasoning-endpoint'

// Task 28b (rebuilding task 23b's lost guard -- the original was never
// committed; git history has zero references to it). Pins the exact
// shape of the reasoning-endpoint's Gemini responseSchema + supported
// intent list against shared/reasoning-response-schema.snapshot.json.
//
// Any future change to either -- a new write domain, a reordered enum, a
// new target field -- makes this test fail ON PURPOSE. That is not a bug
// in the test: regenerate the snapshot deliberately and justify the diff
// in the shipping task's report, the same discipline
// docs/architecture/adding-a-write-domain.md already requires for other
// registry-driven touch points.
//
// Comparison is PARSED deep-equal, never a raw string diff -- the 23b
// verdict this rebuild follows ruled out string comparison specifically
// because a CRLF/LF mismatch between the file at rest and whatever wrote
// it would fail this test for a reason that has nothing to do with the
// schema actually changing. .gitattributes pins the snapshot file itself
// to LF so it can't silently drift on a Windows checkout either.
//
// toEqual alone is not enough on top of that: JS object equality ignores
// property insertion order, so a provider-visible field reordering inside
// buildReasoningResponseSchema() would pass a plain toEqual while still
// being a real, shippable schema change. keyOrderWalk turns every object
// into an ordered [key, value][] before comparing, making order part of
// the assertion.

const snapshotPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'reasoning-response-schema.snapshot.json',
)
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
  schema: unknown
  intents: readonly string[]
}

function keyOrderWalk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keyOrderWalk)
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).map((key) => [
      key,
      keyOrderWalk((value as Record<string, unknown>)[key]),
    ])
  }
  return value
}

describe('reasoning response schema purity (task 28b)', () => {
  it('matches the pinned snapshot by parsed deep-equal', () => {
    const current = { schema: buildReasoningResponseSchema(), intents: SUPPORTED_INTENT_VALUES }
    expect(current).toEqual(snapshot)
  })

  it('matches the pinned snapshot in exact property order, recursively', () => {
    const current = { schema: buildReasoningResponseSchema(), intents: SUPPORTED_INTENT_VALUES }
    expect(keyOrderWalk(current)).toEqual(keyOrderWalk(snapshot))
  })
})
