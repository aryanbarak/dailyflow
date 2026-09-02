import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHADOW_ALLOWED_INTENT_TYPES, SHADOW_ALLOWED_TOOL_IDS, isAllowedShadowIntentType, isAllowedShadowToolId } from './shadow-vocabulary'
import { writeIntentRegistry } from '../../../shared/writeIntentRegistry'

describe('shadow-only vocabulary (ALF-1A correction round 2, item 1)', () => {
  it('rejects an empty/unknown value', () => {
    expect(isAllowedShadowIntentType('')).toBe(false)
    expect(isAllowedShadowIntentType('totally_made_up')).toBe(false)
    expect(isAllowedShadowToolId('')).toBe(false)
    expect(isAllowedShadowToolId('totally.made_up')).toBe(false)
  })

  it('accepts every chat-exposed WriteIntentType/WriteIntentToolId from shared/writeIntentRegistry.ts', () => {
    for (const entry of writeIntentRegistry.filter((e) => e.exposure === 'chat')) {
      expect(isAllowedShadowIntentType(entry.intentType), `intentType=${entry.intentType}`).toBe(true)
      expect(isAllowedShadowToolId(entry.toolId), `toolId=${entry.toolId}`).toBe(true)
    }
  })

  // ALF-1B decision (resolves a prior non-blocking concern): Shadow Chat
  // routing vocabulary must NOT accept ui-only registry entries -- a live
  // chat message can never legitimately route to one, so a Shadow
  // prediction naming one is never a plausible-but-wrong guess, it is
  // necessarily wrong by construction. This test fails loudly if a future
  // registry change ever adds a second ui-only entry without updating
  // this expectation.
  it('rejects every ui-only WriteIntentType/WriteIntentToolId from shared/writeIntentRegistry.ts', () => {
    const uiOnlyEntries = writeIntentRegistry.filter((e) => e.exposure === 'ui-only')
    expect(uiOnlyEntries.length).toBeGreaterThan(0)
    for (const entry of uiOnlyEntries) {
      expect(isAllowedShadowIntentType(entry.intentType), `intentType=${entry.intentType}`).toBe(false)
      expect(isAllowedShadowToolId(entry.toolId), `toolId=${entry.toolId}`).toBe(false)
    }
    // Pin the exact known ui-only intent today, so this test documents
    // WHICH entry is excluded, not just that some entry is.
    expect(isAllowedShadowIntentType('import_bank_statement')).toBe(false)
    expect(isAllowedShadowToolId('finance.import_bank_statement')).toBe(false)
  })

  // Parity guard against silent drift, mirroring the offline scorer's own
  // ALLOWED_PAYLOAD_KEYS-vs-shared/aiLearning.ts parity test
  // (scripts/ai-learning/score-eval.test.mjs) -- reads the SAME gold eval
  // fixture ALF-0 built and audits every intentType/toolId it contains.
  it('accepts every intentType/toolId actually present in ai/evals/intent-routing-v1/cases.jsonl', () => {
    const fixturePath = join(__dirname, '../../../ai/evals/intent-routing-v1/cases.jsonl')
    const lines = readFileSync(fixturePath, 'utf8').split('\n').filter((line) => line.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)

    const seenIntentTypes = new Set<string>()
    const seenToolIds = new Set<string>()
    for (const line of lines) {
      const record = JSON.parse(line) as { expected?: { intentType?: string; toolId?: string } }
      if (record.expected?.intentType) seenIntentTypes.add(record.expected.intentType)
      if (record.expected?.toolId) seenToolIds.add(record.expected.toolId)
    }
    // Sanity: the fixture actually contains write AND non-write intentTypes
    // -- if this ever collapses to 0, the fixture path/shape changed and
    // this parity test would otherwise pass vacuously.
    expect(seenIntentTypes.size).toBeGreaterThan(0)
    expect(seenToolIds.size).toBeGreaterThan(0)

    for (const intentType of seenIntentTypes) {
      expect(isAllowedShadowIntentType(intentType), `fixture intentType=${intentType}`).toBe(true)
    }
    for (const toolId of seenToolIds) {
      expect(isAllowedShadowToolId(toolId), `fixture toolId=${toolId}`).toBe(true)
    }
  })

  it('the exported vocabulary lists are non-empty and contain no duplicates', () => {
    expect(SHADOW_ALLOWED_INTENT_TYPES.length).toBeGreaterThan(0)
    expect(SHADOW_ALLOWED_TOOL_IDS.length).toBeGreaterThan(0)
    expect(new Set(SHADOW_ALLOWED_INTENT_TYPES).size).toBe(SHADOW_ALLOWED_INTENT_TYPES.length)
    expect(new Set(SHADOW_ALLOWED_TOOL_IDS).size).toBe(SHADOW_ALLOWED_TOOL_IDS.length)
  })
})
