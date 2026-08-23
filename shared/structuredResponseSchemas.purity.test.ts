import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildDerivationResponseSchema } from '../agent/worker/context-derivation-endpoint'
import { buildExtractionResponseSchema } from '../agent/worker/personal-memory-extraction-endpoint'
import { buildTaskTitleResponseSchema } from '../agent/worker/task-title-extraction'
import { translateNeutralSchema } from '../agent/worker/providers/gemini/geminiSchemaTranslation'
import type { NeutralObjectSchema } from '../agent/worker/providers/schema/neutralSchema'

// ADR-0018 S2, PHASE A: the baseline proof artifact for the "zero
// behavior" claim S2 makes -- these three snapshots (plus
// reasoningResponseSchema.purity.test.ts, covering the fourth builder)
// pin the exact `responseSchema` JSON each of the four [STRUCTURED_GEN]
// builders sent to Gemini BEFORE the neutral-schema rewrite (PHASE A
// itself never ran translateNeutralSchema -- the snapshot files
// themselves are untouched by PHASE B).
//
// PHASE B rewrote the builders to emit the neutral subset
// (providers/schema/neutralSchema.ts) and added
// providers/gemini/geminiSchemaTranslation.ts to translate it back to
// this exact Gemini dialect at call time -- this test now asserts
// translateNeutralSchema(builder()) against the SAME pinned snapshot,
// which is exactly what "byte-identical round-trip" means for S2's
// zero-behavior-change proof.
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

const BUILDERS: ReadonlyArray<{ name: string; snapshotFile: string; build: () => NeutralObjectSchema }> = [
  { name: 'derivation (context-derivation-endpoint.ts)', snapshotFile: 'derivation-response-schema.snapshot.json', build: buildDerivationResponseSchema },
  { name: 'extraction (personal-memory-extraction-endpoint.ts)', snapshotFile: 'extraction-response-schema.snapshot.json', build: buildExtractionResponseSchema },
  { name: 'task-title (task-title-extraction.ts)', snapshotFile: 'task-title-response-schema.snapshot.json', build: buildTaskTitleResponseSchema },
]

describe('structured response schema purity (ADR-0018 S2; translation round-trip)', () => {
  for (const builder of BUILDERS) {
    describe(builder.name, () => {
      const snapshot = loadSnapshot(builder.snapshotFile) as { schema: unknown }

      it('matches the pinned snapshot by parsed deep-equal', () => {
        expect({ schema: translateNeutralSchema(builder.build()) }).toEqual(snapshot)
      })

      it('matches the pinned snapshot in exact property order, recursively', () => {
        expect(keyOrderWalk({ schema: translateNeutralSchema(builder.build()) })).toEqual(keyOrderWalk(snapshot))
      })
    })
  }
})
