import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildDerivationResponseSchema } from '../agent/worker/context-derivation-endpoint'
import { buildExtractionResponseSchema } from '../agent/worker/personal-memory-extraction-endpoint'
import { buildTaskTitleResponseSchema } from '../agent/worker/task-title-extraction'

// ADR-0018 S2, PHASE A: the baseline proof artifact for the "zero
// behavior" claim S2 makes -- these three snapshots (plus the existing
// reasoningResponseSchema.purity.test.ts, left untouched, covering the
// fourth builder) pin the exact `responseSchema` JSON each of the four
// [STRUCTURED_GEN] builders currently sends to Gemini, captured from the
// REAL builders BEFORE any neutral-schema rewrite. PHASE B rewrites the
// builders to emit a neutral subset and translates it back to this exact
// Gemini dialect at call time -- these tests must still pass, UNCHANGED,
// after that rewrite: that is what "byte-identical" means in the S2 task.
//
// Same discipline as reasoningResponseSchema.purity.test.ts (see that
// file's own header comment for the full rationale): parsed deep-equal
// AND a recursive key-order walk, because plain toEqual ignores property
// insertion order and a provider-visible field reordering is a real,
// shippable schema change. .gitattributes pins all three snapshot files
// to LF so a Windows checkout can't silently drift them either.

function loadSnapshot(fileName: string): unknown {
  const snapshotPath = path.join(path.dirname(fileURLToPath(import.meta.url)), fileName)
  return JSON.parse(readFileSync(snapshotPath, 'utf8'))
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

const BUILDERS: ReadonlyArray<{ name: string; snapshotFile: string; build: () => unknown }> = [
  { name: 'derivation (context-derivation-endpoint.ts)', snapshotFile: 'derivation-response-schema.snapshot.json', build: buildDerivationResponseSchema },
  { name: 'extraction (personal-memory-extraction-endpoint.ts)', snapshotFile: 'extraction-response-schema.snapshot.json', build: buildExtractionResponseSchema },
  { name: 'task-title (task-title-extraction.ts)', snapshotFile: 'task-title-response-schema.snapshot.json', build: buildTaskTitleResponseSchema },
]

describe('structured response schema purity (ADR-0018 S2)', () => {
  for (const builder of BUILDERS) {
    describe(builder.name, () => {
      const snapshot = loadSnapshot(builder.snapshotFile) as { schema: unknown }

      it('matches the pinned snapshot by parsed deep-equal', () => {
        expect({ schema: builder.build() }).toEqual(snapshot)
      })

      it('matches the pinned snapshot in exact property order, recursively', () => {
        expect(keyOrderWalk({ schema: builder.build() })).toEqual(keyOrderWalk(snapshot))
      })
    })
  }
})
