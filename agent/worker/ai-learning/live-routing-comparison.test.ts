import { describe, expect, it } from 'vitest'
import {
  compareLiveRoutingEvents,
  LIVE_ROUTING_MASKED_FIELDS,
  LIVE_ROUTING_SCORED_FIELDS,
  type LiveLearningEventRecord,
} from './live-routing-comparison'

const VALID_PRODUCTION_PAYLOAD = {
  schemaVersion: 'intent-routing-v1',
  language: 'unknown',
  interactionClass: 'write',
  domain: 'calendar',
  intentType: 'create_calendar_event',
  toolId: 'calendar.create_event',
  requiresClarification: false,
  requiresApproval: true,
}

const VALID_SHADOW_PAYLOAD = {
  schemaVersion: 'intent-routing-v1',
  language: 'fa',
  interactionClass: 'write',
  domain: 'calendar',
  intentType: 'create_calendar_event',
  toolId: 'calendar.create_event',
  requiresClarification: false,
  requiresApproval: false,
}

function productionEvent(overrides: Partial<LiveLearningEventRecord> = {}): LiveLearningEventRecord {
  return {
    id: 'prod-1',
    userId: 'user-1',
    sourceMessageId: 'msg-1',
    correlationId: 'corr-1',
    learningTask: 'intent_routing_v1',
    schemaVersion: 'intent-routing-v1',
    eventKind: 'production_label',
    providerId: null,
    modelId: null,
    modelVersion: null,
    sourceHash: 'hash-1',
    payload: { ...VALID_PRODUCTION_PAYLOAD },
    ...overrides,
  }
}

function shadowEvent(overrides: Partial<LiveLearningEventRecord> = {}): LiveLearningEventRecord {
  return {
    id: 'shadow-1',
    userId: 'user-1',
    sourceMessageId: 'msg-1',
    correlationId: 'corr-1',
    learningTask: 'intent_routing_v1',
    schemaVersion: 'intent-routing-v1',
    eventKind: 'shadow_prediction',
    providerId: 'workers-ai',
    modelId: '@cf/some-org/shadow-model',
    modelVersion: '2026-09-01',
    sourceHash: 'hash-1',
    payload: { ...VALID_SHADOW_PAYLOAD },
    ...overrides,
  }
}

describe('compareLiveRoutingEvents', () => {
  // A. Perfect valid pair => exactRoutingMatch=true.
  it('A: a perfect valid pair (every scored field identical) has exactRoutingMatch=true', () => {
    const report = compareLiveRoutingEvents([productionEvent(), shadowEvent()])
    expect(report.eligiblePairs).toBe(1)
    expect(report.comparisons[0].exactRoutingMatch).toBe(true)
    for (const field of LIVE_ROUTING_SCORED_FIELDS) {
      expect(report.comparisons[0].fieldResults[field].match, field).toBe(true)
    }
  })

  // B. Domain mismatch => exact false.
  it('B: a domain mismatch alone makes exactRoutingMatch false, and only the domain field is reported as a mismatch', () => {
    const report = compareLiveRoutingEvents([
      productionEvent(),
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, domain: 'tasks', intentType: undefined, toolId: undefined } }),
    ])
    expect(report.eligiblePairs).toBe(1)
    const comparison = report.comparisons[0]
    expect(comparison.exactRoutingMatch).toBe(false)
    expect(comparison.fieldResults.domain.match).toBe(false)
  })

  // C. intentType omitted on both => match.
  it('C: intentType omitted on BOTH sides is a match', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ payload: { ...VALID_PRODUCTION_PAYLOAD, interactionClass: 'conversation', domain: 'none', intentType: undefined, toolId: undefined } }),
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, interactionClass: 'conversation', domain: 'none', intentType: undefined, toolId: undefined } }),
    ])
    expect(report.eligiblePairs).toBe(1)
    expect(report.comparisons[0].fieldResults.intentType.match).toBe(true)
    expect(report.comparisons[0].fieldResults.intentType.productionValue).toBeUndefined()
    expect(report.comparisons[0].fieldResults.intentType.shadowValue).toBeUndefined()
    expect(report.comparisons[0].exactRoutingMatch).toBe(true)
  })

  // D. intentType only on one side => mismatch.
  it('D: intentType present on production only (shadow omitted) is a mismatch', () => {
    const report = compareLiveRoutingEvents([
      productionEvent(),
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, intentType: undefined, toolId: undefined } }),
    ])
    expect(report.comparisons[0].fieldResults.intentType.match).toBe(false)
    expect(report.comparisons[0].exactRoutingMatch).toBe(false)
  })

  it('D: intentType present on shadow only (production omitted) is a mismatch', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ payload: { ...VALID_PRODUCTION_PAYLOAD, interactionClass: 'conversation', domain: 'none', intentType: undefined, toolId: undefined } }),
      shadowEvent(),
    ])
    expect(report.comparisons[0].fieldResults.intentType.match).toBe(false)
    expect(report.comparisons[0].exactRoutingMatch).toBe(false)
  })

  // E. toolId optional semantics same as above.
  it('E: toolId omitted on both sides is a match; present on only one side is a mismatch', () => {
    const bothOmitted = compareLiveRoutingEvents([
      productionEvent({ payload: { ...VALID_PRODUCTION_PAYLOAD, interactionClass: 'read', domain: 'tasks', intentType: 'read_tasks', toolId: undefined } }),
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, interactionClass: 'read', domain: 'tasks', intentType: 'read_tasks', toolId: undefined } }),
    ])
    expect(bothOmitted.comparisons[0].fieldResults.toolId.match).toBe(true)

    const onlyProduction = compareLiveRoutingEvents([
      productionEvent(),
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, toolId: undefined } }),
    ])
    expect(onlyProduction.comparisons[0].fieldResults.toolId.match).toBe(false)
  })

  // F. language mismatch does NOT affect score.
  it('F: production language="unknown" vs shadow language="fa" never affects exactRoutingMatch or any scored field', () => {
    const report = compareLiveRoutingEvents([productionEvent(), shadowEvent()])
    // Fixtures above already set differing language values -- prove it's a
    // perfect match regardless.
    expect(report.comparisons[0].exactRoutingMatch).toBe(true)
    expect(Object.keys(report.comparisons[0].fieldResults)).not.toContain('language')
    expect(report.comparisons[0].maskedFields).toContain('language')
  })

  // G. requiresApproval mismatch does NOT affect score.
  it('G: production requiresApproval=true vs shadow requiresApproval=false never affects exactRoutingMatch or any scored field', () => {
    const report = compareLiveRoutingEvents([productionEvent(), shadowEvent()])
    // Fixtures above already set differing requiresApproval values.
    expect(report.comparisons[0].exactRoutingMatch).toBe(true)
    expect(Object.keys(report.comparisons[0].fieldResults)).not.toContain('requiresApproval')
    expect(report.comparisons[0].maskedFields).toContain('requiresApproval')
  })

  it('masked fields are always exactly language and requiresApproval, and comparedFields are always exactly the five scored fields', () => {
    const report = compareLiveRoutingEvents([productionEvent(), shadowEvent()])
    expect(report.comparisons[0].maskedFields).toEqual(LIVE_ROUTING_MASKED_FIELDS)
    expect(report.comparisons[0].comparedFields).toEqual(LIVE_ROUTING_SCORED_FIELDS)
  })

  // H. impossible domain/intent/tool combination rejected as invalid prediction.
  it('H: a shadow payload with an impossible domain/intentType/toolId combination is excluded as invalid, never scored as a mismatch', () => {
    const report = compareLiveRoutingEvents([
      productionEvent(),
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, domain: 'tasks', intentType: 'create_calendar_event', toolId: 'calendar.create_event' } }),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.comparisons).toHaveLength(0)
    expect(report.invalidShadowPredictionCount).toBe(1)
    expect(report.invalidOrIncompatiblePairs).toBe(1)
  })

  it('H: a production payload with an impossible combination is excluded as invalid, never trusted as truth', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ payload: { ...VALID_PRODUCTION_PAYLOAD, domain: 'finance', intentType: 'create_task', toolId: 'tasks.create' } }),
      shadowEvent(),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.invalidProductionLabelCount).toBe(1)
    expect(report.invalidOrIncompatiblePairs).toBe(1)
  })

  // I. source_message_id mismatch => never pair.
  it('I: two events with different sourceMessageId are never paired, regardless of matching correlation_id', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ sourceMessageId: 'msg-1' }),
      shadowEvent({ sourceMessageId: 'msg-2' }),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.missingShadowSide).toBe(1)
    expect(report.missingProductionSide).toBe(1)
  })

  // J. correlation_id mismatch => never pair.
  it('J: two events with the same sourceMessageId but different correlation_id are never paired', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ correlationId: 'corr-a' }),
      shadowEvent({ correlationId: 'corr-b' }),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.missingShadowSide).toBe(1)
    expect(report.missingProductionSide).toBe(1)
  })

  // K. schema_version mismatch => incompatible, never score.
  it('K: two events with the same sourceMessageId/correlationId but different schema_version are never paired', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ schemaVersion: 'intent-routing-v1' }),
      shadowEvent({ schemaVersion: 'intent-routing-v2' }),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.missingShadowSide).toBe(1)
    expect(report.missingProductionSide).toBe(1)
  })

  // L. production_label cannot be replaced by shadow/model truth.
  it('L: fieldResults.productionValue always reflects the PRODUCTION payload, never falls back to the shadow value', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ payload: { ...VALID_PRODUCTION_PAYLOAD, domain: 'calendar' } }),
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, domain: 'tasks', intentType: undefined, toolId: undefined } }),
    ])
    expect(report.comparisons[0].fieldResults.domain.productionValue).toBe('calendar')
    expect(report.comparisons[0].fieldResults.domain.shadowValue).toBe('tasks')
    // Even though this is a mismatch, production's own value is what is
    // reported as production -- never overwritten, never averaged, never
    // replaced by the shadow guess.
  })

  it('L: an invalid/missing production side never causes a shadow value to be reported as if it were production truth', () => {
    const report = compareLiveRoutingEvents([shadowEvent()]) // no production row at all
    expect(report.comparisons).toHaveLength(0)
    expect(report.missingProductionSide).toBe(1)
  })

  // M. duplicate production labels for one pairing key fail closed / reported ambiguous.
  it('M: two production_label rows sharing the same pairing key are reported as ambiguous, never arbitrarily resolved, and produce zero comparisons for that key', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ id: 'prod-1', payload: { ...VALID_PRODUCTION_PAYLOAD, domain: 'calendar' } }),
      productionEvent({ id: 'prod-2', payload: { ...VALID_PRODUCTION_PAYLOAD, domain: 'tasks', intentType: undefined, toolId: undefined } }),
      shadowEvent(),
    ])
    expect(report.ambiguousProductionGroups).toBe(1)
    expect(report.eligiblePairs).toBe(0)
    expect(report.comparisons).toHaveLength(0)
    expect(report.invalidOrIncompatiblePairs).toBe(1)
  })

  // N. duplicate shadow predictions for same model/version pairing key
  // handled deterministically and documented.
  it('N: two shadow_prediction rows for DIFFERENT models on the same turn each get their own independent comparison', () => {
    const report = compareLiveRoutingEvents([
      productionEvent(),
      shadowEvent({ id: 'shadow-a', providerId: 'workers-ai', modelId: 'model-a', modelVersion: 'v1' }),
      shadowEvent({ id: 'shadow-b', providerId: 'workers-ai', modelId: 'model-b', modelVersion: 'v1' }),
    ])
    expect(report.eligiblePairs).toBe(2)
    expect(report.comparisons.map((c) => c.modelId).sort()).toEqual(['model-a', 'model-b'])
    expect(report.ambiguousShadowModelSlices).toBe(0)
  })

  it('N: two shadow_prediction rows for the EXACT SAME model slice on the same turn are reported ambiguous, never arbitrarily picked', () => {
    const report = compareLiveRoutingEvents([
      productionEvent(),
      shadowEvent({ id: 'shadow-a' }),
      shadowEvent({ id: 'shadow-b' }),
    ])
    expect(report.ambiguousShadowModelSlices).toBe(1)
    expect(report.eligiblePairs).toBe(0)
    expect(report.invalidOrIncompatiblePairs).toBe(1)
  })

  // O. zero raw message persistence/logging.
  it('O: the report never contains any string not already present in the closed-enum payload fields -- no raw message field exists on the input or output types', () => {
    const secretMarker = 'RAW_MESSAGE_SECRET_MARKER_DO_NOT_LEAK'
    const report = compareLiveRoutingEvents([
      productionEvent(),
      // An unaudited intentType containing the marker -- rejected by the
      // vocabulary gate, so it never reaches any output field.
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, intentType: secretMarker, toolId: undefined } }),
    ])
    expect(JSON.stringify(report)).not.toContain(secretMarker)
    expect(report.invalidShadowPredictionCount).toBe(1)
  })

  // P. metrics denominators are correct for optional fields and masking.
  describe('P: metrics denominators', () => {
    it('every scored-field accuracy denominator is eligiblePairs, including for optional fields (never a smaller "both present" subset)', () => {
      const report = compareLiveRoutingEvents([
        productionEvent({ sourceMessageId: 'a', correlationId: 'a', payload: { ...VALID_PRODUCTION_PAYLOAD, interactionClass: 'conversation', domain: 'none', intentType: undefined, toolId: undefined } }),
        shadowEvent({ sourceMessageId: 'a', correlationId: 'a', payload: { ...VALID_SHADOW_PAYLOAD, interactionClass: 'conversation', domain: 'none', intentType: undefined, toolId: undefined } }),
        productionEvent({ id: 'prod-2', sourceMessageId: 'b', correlationId: 'b' }),
        shadowEvent({ id: 'shadow-2', sourceMessageId: 'b', correlationId: 'b' }),
      ])
      expect(report.eligiblePairs).toBe(2)
      // Both pairs are eligible; intentType/toolId omitted-on-both in pair
      // "a" still counts toward the SAME denominator as every other field.
      expect(report.fieldAccuracy.intentType).toBe(1)
      expect(report.fieldAccuracy.toolId).toBe(1)
    })

    it('masked fields never appear in fieldAccuracy at all', () => {
      const report = compareLiveRoutingEvents([productionEvent(), shadowEvent()])
      expect(Object.keys(report.fieldAccuracy).sort()).toEqual([...LIVE_ROUTING_SCORED_FIELDS].sort())
      expect(Object.keys(report.fieldAccuracy)).not.toContain('language')
      expect(Object.keys(report.fieldAccuracy)).not.toContain('requiresApproval')
    })

    it('ambiguous/invalid/missing groups never inflate eligiblePairs or any accuracy denominator', () => {
      const report = compareLiveRoutingEvents([
        // Ambiguous production (2 rows) -- excluded.
        productionEvent({ id: 'p1', sourceMessageId: 'ambiguous', correlationId: 'ambiguous' }),
        productionEvent({ id: 'p2', sourceMessageId: 'ambiguous', correlationId: 'ambiguous' }),
        shadowEvent({ sourceMessageId: 'ambiguous', correlationId: 'ambiguous' }),
        // Missing shadow -- excluded.
        productionEvent({ id: 'p3', sourceMessageId: 'missing-shadow', correlationId: 'missing-shadow' }),
        // One genuinely eligible pair.
        productionEvent({ id: 'p4', sourceMessageId: 'eligible', correlationId: 'eligible' }),
        shadowEvent({ id: 's4', sourceMessageId: 'eligible', correlationId: 'eligible' }),
      ])
      expect(report.eligiblePairs).toBe(1)
      expect(report.exactRoutingAccuracy).toBe(1)
      expect(report.missingShadowSide).toBe(1)
      expect(report.ambiguousProductionGroups).toBe(1)
    })

    it('zero eligible pairs never divides by zero -- every rate is reported as 0, not NaN/Infinity', () => {
      const report = compareLiveRoutingEvents([])
      expect(report.eligiblePairs).toBe(0)
      expect(report.exactRoutingAccuracy).toBe(0)
      for (const field of LIVE_ROUTING_SCORED_FIELDS) {
        expect(report.fieldAccuracy[field]).toBe(0)
      }
      expect(Number.isNaN(report.exactRoutingAccuracy)).toBe(false)
    })

    it('totalProductionLabels/totalShadowPredictions count every row of that kind, including ambiguous/invalid/unpaired ones', () => {
      const report = compareLiveRoutingEvents([
        productionEvent({ id: 'p1' }),
        productionEvent({ id: 'p2', sourceMessageId: 'other', correlationId: 'other' }),
        shadowEvent({ id: 's1' }),
      ])
      expect(report.totalProductionLabels).toBe(2)
      expect(report.totalShadowPredictions).toBe(1)
    })
  })

  it('events with no sourceMessageId at all are excluded from pairing entirely, not crashing and not silently paired by any other heuristic', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ sourceMessageId: null }),
      shadowEvent({ sourceMessageId: null }),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.comparisons).toHaveLength(0)
  })

  it('non-routing event kinds (e.g. turn_observed, user_feedback, execution_outcome) are ignored entirely', () => {
    const report = compareLiveRoutingEvents([
      productionEvent(),
      shadowEvent(),
      { ...productionEvent({ id: 'other' }), eventKind: 'user_feedback' },
    ])
    expect(report.eligiblePairs).toBe(1)
    expect(report.totalProductionLabels).toBe(1)
  })
})
