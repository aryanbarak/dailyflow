import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildReasoningResponseSchema, SUPPORTED_INTENT_VALUES } from '../agent/worker/reasoning-endpoint'
import { translateNeutralSchema } from '../agent/worker/providers/gemini/geminiSchemaTranslation'

// Task 28b (rebuilding task 23b's lost guard -- the original was never
// committed; git history has zero references to it). Pins the exact
// shape of the reasoning-endpoint's Gemini responseSchema + supported
// intent list against shared/reasoning-response-schema.snapshot.json.
//
// ADR-0018 S2: buildReasoningResponseSchema now returns the NEUTRAL
// schema subset, not Gemini's dialect (see providers/schema/
// neutralSchema.ts) -- this test now compares translateNeutralSchema()'s
// OUTPUT against the pinned snapshot, which is exactly the byte-identical
// round-trip proof S2's own zero-behavior-change claim rests on: the
// snapshot itself is untouched, captured from the builder BEFORE the
// neutral-schema rewrite (ADR-0018 S2 Phase A).
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

describe('reasoning response schema purity (task 28b; translation round-trip, ADR-0018 S2)', () => {
  it('matches the pinned snapshot by parsed deep-equal', () => {
    const current = { schema: translateNeutralSchema(buildReasoningResponseSchema()), intents: SUPPORTED_INTENT_VALUES }
    expect(current).toEqual(snapshot)
  })

  it('matches the pinned snapshot in exact property order, recursively', () => {
    const current = { schema: translateNeutralSchema(buildReasoningResponseSchema()), intents: SUPPORTED_INTENT_VALUES }
    expect(keyOrderWalk(current)).toEqual(keyOrderWalk(snapshot))
  })
})
