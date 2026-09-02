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
    // Canonical (producerType, labelConfidence) pair for production_label
    // per shared/aiLearning.ts's EVENT_KIND_SEMANTICS (ALF-1B correction
    // 2, item 1).
    producerType: 'deterministic_policy',
    labelConfidence: 'validated',
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
    // Canonical (producerType, labelConfidence) pair for shadow_prediction
    // per shared/aiLearning.ts's EVENT_KIND_SEMANTICS (ALF-1B correction
    // 2, item 1).
    producerType: 'shadow_model',
    labelConfidence: 'candidate',
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
  // ALF-1B correction 2, item 5: renamed from the original "...only the
  // domain field is reported as a mismatch" -- the fixture below (needed
  // to stay semantically valid under the ALF-1B correction 1 consistency
  // gate; see its own comment) also changes interactionClass and
  // intentType/toolId, so domain is no longer the ONLY field this
  // comparison disagrees on. The assertions below only ever checked
  // domain.match and exactRoutingMatch -- never "only domain" -- so this
  // is a description fix, not a behavior or assertion change; the
  // semantic-consistency gate itself is not weakened to chase the old name.
  it('B: a domain mismatch makes exactRoutingMatch false, and the domain field itself is reported as a mismatch', () => {
    const report = compareLiveRoutingEvents([
      productionEvent(),
      // domain differs from production ('calendar'); intentType/toolId/
      // interactionClass are changed to a DIFFERENT, still semantically
      // valid combination (read_tasks) rather than just clearing
      // intentType/toolId, since a bare domain='tasks' with no intentType
      // is not itself a recognized combination (ALF-1B correction 1,
      // item 3 -- see shadow-semantic-consistency.ts's closed
      // INTENTLESS_INTERACTION_DOMAIN_PAIRS mapping).
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, interactionClass: 'read', domain: 'tasks', intentType: 'read_tasks', toolId: undefined } }),
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
      // interactionClass/domain switched to the closed intentless
      // combination (conversation/none) alongside omitting intentType --
      // a bare domain='calendar'/interactionClass='write' with no
      // intentType is not itself a recognized combination (ALF-1B
      // correction 1, item 3).
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, interactionClass: 'conversation', domain: 'none', intentType: undefined, toolId: undefined } }),
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

  // ALF-1B correction 2, item 1: restore canonical eventKind/producerType/
  // labelConfidence governance semantics (shared/aiLearning.ts's own
  // EVENT_KIND_SEMANTICS, reused via eventKindSemantics -- never a second,
  // independently hand-typed mapping). A model-sourced row can never
  // become production truth merely by claiming eventKind='production_label'.
  describe('producer/confidence governance (ALF-1B correction 2, item 1)', () => {
    it('a row claiming eventKind=production_label with producerType=shadow_model/labelConfidence=candidate is rejected, never accepted as production truth', () => {
      const report = compareLiveRoutingEvents([
        productionEvent({ producerType: 'shadow_model', labelConfidence: 'candidate' }),
        shadowEvent(),
      ])
      expect(report.eligiblePairs).toBe(0)
      expect(report.invalidProductionLabelCount).toBe(1)
    })

    it('a row claiming eventKind=shadow_prediction with producerType=deterministic_policy/labelConfidence=validated fails closed, never scored as a candidate', () => {
      const report = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ producerType: 'deterministic_policy', labelConfidence: 'validated' }),
      ])
      expect(report.eligiblePairs).toBe(0)
      expect(report.invalidShadowPredictionCount).toBe(1)
    })

    it('an unrecognized producerType value is rejected on either side', () => {
      const reportProd = compareLiveRoutingEvents([
        productionEvent({ producerType: 'not_a_real_producer_type' }),
        shadowEvent(),
      ])
      expect(reportProd.invalidProductionLabelCount).toBe(1)

      const reportShadow = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ producerType: 'not_a_real_producer_type' }),
      ])
      expect(reportShadow.invalidShadowPredictionCount).toBe(1)
    })

    it('an unrecognized labelConfidence value is rejected on either side', () => {
      const reportProd = compareLiveRoutingEvents([
        productionEvent({ labelConfidence: 'not_a_real_confidence' }),
        shadowEvent(),
      ])
      expect(reportProd.invalidProductionLabelCount).toBe(1)

      const reportShadow = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ labelConfidence: 'not_a_real_confidence' }),
      ])
      expect(reportShadow.invalidShadowPredictionCount).toBe(1)
    })

    it('a production_label with labelConfidence=null (instead of "validated") is rejected -- the exact pair is required, not just "some" confidence', () => {
      const report = compareLiveRoutingEvents([
        productionEvent({ labelConfidence: null }),
        shadowEvent(),
      ])
      expect(report.invalidProductionLabelCount).toBe(1)
    })
  })

  // ALF-1B correction 2, item 2: full live-eval envelope validation --
  // learningTask/schemaVersion must be the canonical routing pair, and a
  // shadow_prediction must carry non-empty provider/model/version
  // provenance. Fail closed / explicitly reported, never scored.
  describe('full envelope validation (ALF-1B correction 2, item 2)', () => {
    it('an unknown learningTask is rejected on either side', () => {
      const reportProd = compareLiveRoutingEvents([
        productionEvent({ learningTask: 'some_other_task' }),
        shadowEvent(),
      ])
      expect(reportProd.invalidProductionLabelCount).toBe(1)

      const reportShadow = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ learningTask: 'some_other_task' }),
      ])
      expect(reportShadow.invalidShadowPredictionCount).toBe(1)
    })

    it('a wrong top-level schema_version is rejected even when learningTask is correct', () => {
      const report = compareLiveRoutingEvents([
        productionEvent({ schemaVersion: 'intent-routing-v2' }),
        shadowEvent(),
      ])
      expect(report.invalidProductionLabelCount).toBe(1)
    })

    it('a top-level/payload schema disagreement is rejected (top-level valid, payload schemaVersion wrong)', () => {
      const report = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, schemaVersion: 'intent-routing-v2' } }),
      ])
      expect(report.invalidShadowPredictionCount).toBe(1)
    })

    it('a shadow_prediction missing provider_id is rejected, never normalized to an eligible empty-string model slice', () => {
      const report = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ providerId: null }),
      ])
      expect(report.eligiblePairs).toBe(0)
      expect(report.invalidShadowPredictionCount).toBe(1)
    })

    it('a shadow_prediction missing model_id is rejected, never normalized to an eligible empty-string model slice', () => {
      const report = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ modelId: null }),
      ])
      expect(report.eligiblePairs).toBe(0)
      expect(report.invalidShadowPredictionCount).toBe(1)
    })

    it('a shadow_prediction missing model_version is rejected, never normalized to an eligible empty-string model slice', () => {
      const report = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ modelVersion: null }),
      ])
      expect(report.eligiblePairs).toBe(0)
      expect(report.invalidShadowPredictionCount).toBe(1)
    })

    it('a valid comparison never carries an empty-string providerId/modelId/modelVersion', () => {
      const report = compareLiveRoutingEvents([productionEvent(), shadowEvent()])
      expect(report.comparisons[0].providerId).not.toBe('')
      expect(report.comparisons[0].modelId).not.toBe('')
      expect(report.comparisons[0].modelVersion).not.toBe('')
    })

    it('two rows sharing the same MALFORMED learningTask/schemaVersion strings are never treated as a comparable pair merely because their malformed strings happen to match each other', () => {
      const report = compareLiveRoutingEvents([
        productionEvent({ learningTask: 'bogus_task', schemaVersion: 'bogus-schema' }),
        shadowEvent({ learningTask: 'bogus_task', schemaVersion: 'bogus-schema' }),
      ])
      expect(report.eligiblePairs).toBe(0)
      expect(report.comparisons).toHaveLength(0)
      expect(report.invalidProductionLabelCount).toBe(1)
      expect(report.invalidShadowPredictionCount).toBe(1)
    })
  })

  // ALF-1B correction 2, item 4: invalid Shadow accounting must not depend
  // on whether the corresponding production group later proves clean.
  describe('invalid Shadow counting is independent of production cleanliness (ALF-1B correction 2, item 4)', () => {
    it('an invalid shadow prediction is counted even when production for the same turn is MISSING entirely', () => {
      const report = compareLiveRoutingEvents([
        shadowEvent({ providerId: null }), // envelope-invalid, no production row at all
      ])
      expect(report.invalidShadowPredictionCount).toBe(1)
      expect(report.eligiblePairs).toBe(0)
    })

    it('an invalid shadow prediction is counted even when production for the same turn is AMBIGUOUS (duplicate rows)', () => {
      const report = compareLiveRoutingEvents([
        productionEvent({ id: 'prod-1' }),
        productionEvent({ id: 'prod-2' }),
        shadowEvent({ providerId: null }), // envelope-invalid
      ])
      expect(report.ambiguousProductionGroups).toBe(1)
      expect(report.invalidShadowPredictionCount).toBe(1)
      expect(report.eligiblePairs).toBe(0)
    })

    it('an invalid shadow prediction is counted even when production for the same turn is itself INVALID', () => {
      const report = compareLiveRoutingEvents([
        productionEvent({ producerType: 'shadow_model', labelConfidence: 'candidate' }), // envelope-invalid production
        shadowEvent({ providerId: null }), // envelope-invalid shadow
      ])
      expect(report.invalidProductionLabelCount).toBe(1)
      expect(report.invalidShadowPredictionCount).toBe(1)
      expect(report.eligiblePairs).toBe(0)
    })

    it('an AMBIGUOUS shadow model slice is counted even when production for the same turn is missing/invalid', () => {
      const report = compareLiveRoutingEvents([
        shadowEvent({ id: 'shadow-a' }),
        shadowEvent({ id: 'shadow-b' }), // same model slice as shadow-a -- ambiguous
      ])
      expect(report.ambiguousShadowModelSlices).toBe(1)
      expect(report.eligiblePairs).toBe(0)
    })

    it('a genuinely VALID shadow prediction with no clean production counterpart produces no comparison and is not miscounted as invalid', () => {
      const report = compareLiveRoutingEvents([
        shadowEvent(), // fully valid, no production row at all in this group
      ])
      expect(report.invalidShadowPredictionCount).toBe(0)
      expect(report.ambiguousShadowModelSlices).toBe(0)
      expect(report.missingProductionSide).toBe(1)
      expect(report.comparisons).toHaveLength(0)
    })
  })

  // ALF-1B correction 3: Shadow envelope/provenance MUST be validated
  // BEFORE modelKey grouping -- modelKey normalizes a missing providerId/
  // modelId/modelVersion to '' rather than rejecting it, so two DIFFERENT
  // envelope-invalid rows could previously collide into the SAME
  // synthetic key and be misclassified as one ambiguous model slice
  // instead of two independently invalid rows.
  describe('Shadow provenance validated before model-slice grouping (ALF-1B correction 3)', () => {
    // A) two shadow rows, same turn, BOTH providerId=null, same model/version.
    it('A: two shadow rows both missing providerId (same modelId/modelVersion) are each counted as their own invalid row, never merged into one ambiguous slice', () => {
      const report = compareLiveRoutingEvents([
        shadowEvent({ id: 'shadow-a', providerId: null }),
        shadowEvent({ id: 'shadow-b', providerId: null }),
      ])
      expect(report.invalidShadowPredictionCount).toBe(2)
      expect(report.ambiguousShadowModelSlices).toBe(0)
      expect(report.eligiblePairs).toBe(0)
    })

    // B) one malformed shadow row (providerId=null) plus one fully valid
    // Shadow row for the same turn.
    it('B: a malformed shadow row (missing providerId) is counted as invalid and excluded, while a separate fully-valid shadow row still compares against a clean production label', () => {
      const report = compareLiveRoutingEvents([
        productionEvent(),
        shadowEvent({ id: 'shadow-malformed', providerId: null }),
        shadowEvent({ id: 'shadow-valid' }),
      ])
      expect(report.invalidShadowPredictionCount).toBe(1)
      expect(report.ambiguousShadowModelSlices).toBe(0)
      expect(report.eligiblePairs).toBe(1)
      expect(report.comparisons[0].shadowEventId).toBe('shadow-valid')
    })

    // C) two fully provenance-valid Shadow rows for the exact same
    // provider/model/version -- preserves the existing duplicate
    // semantics (matches test N above, re-asserted in this context).
    it('C: two fully provenance-valid shadow rows for the exact same model slice are reported ambiguous, never arbitrarily picked', () => {
      const report = compareLiveRoutingEvents([
        shadowEvent({ id: 'shadow-a' }),
        shadowEvent({ id: 'shadow-b' }),
      ])
      expect(report.ambiguousShadowModelSlices).toBe(1)
      expect(report.invalidShadowPredictionCount).toBe(0)
      expect(report.eligiblePairs).toBe(0)
    })

    // D) two provenance-valid duplicate rows for the same model slice
    // where one payload is semantically invalid -- the slice stays
    // ambiguous and excluded; the valid-looking duplicate is never
    // arbitrarily selected as "the" prediction.
    it('D: a provenance-valid duplicate model slice stays ambiguous even when only ONE of the two payloads is semantically invalid', () => {
      const report = compareLiveRoutingEvents([
        shadowEvent({ id: 'shadow-valid-payload' }),
        shadowEvent({
          id: 'shadow-invalid-payload',
          payload: { ...VALID_SHADOW_PAYLOAD, domain: 'tasks', intentType: 'create_calendar_event', toolId: 'calendar.create_event' },
        }),
      ])
      expect(report.ambiguousShadowModelSlices).toBe(1)
      expect(report.invalidShadowPredictionCount).toBe(0)
      expect(report.eligiblePairs).toBe(0)
      expect(report.comparisons).toHaveLength(0)
    })
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
      // See test B's comment above on why this uses read_tasks rather than
      // a bare domain='tasks' with no intentType.
      shadowEvent({ payload: { ...VALID_SHADOW_PAYLOAD, interactionClass: 'read', domain: 'tasks', intentType: 'read_tasks', toolId: undefined } }),
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

  // ALF-1B correction 2, item 3: a missing sourceMessageId must never be
  // silently dropped from consideration -- it is explicitly counted as
  // invalid/unpairable (not merely "excluded"), and the same applies
  // whether it's a production_label or a shadow_prediction row missing it.
  it('a production_label with no sourceMessageId is reported as an invalid, unpairable production label, never silently lost', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ sourceMessageId: null }),
      shadowEvent(),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.comparisons).toHaveLength(0)
    expect(report.invalidProductionLabelCount).toBe(1)
    // The shadow row now has no group to belong to at all (its own
    // sourceMessageId='msg-1' no longer shares a pairing key with
    // anything) -- missingProductionSide reflects that it is a shadow row
    // with no production counterpart in ITS OWN group.
    expect(report.missingProductionSide).toBe(1)
  })

  it('a shadow_prediction with no sourceMessageId is reported as an invalid, unpairable shadow prediction, never silently lost', () => {
    const report = compareLiveRoutingEvents([
      productionEvent(),
      shadowEvent({ sourceMessageId: null }),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.comparisons).toHaveLength(0)
    expect(report.invalidShadowPredictionCount).toBe(1)
    // The production row's own group now has no shadow row in it at all.
    expect(report.missingShadowSide).toBe(1)
  })

  it('production and shadow rows both missing sourceMessageId are each independently reported as invalid, never crashing and never silently paired by any other heuristic', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ sourceMessageId: null }),
      shadowEvent({ sourceMessageId: null }),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.comparisons).toHaveLength(0)
    expect(report.invalidProductionLabelCount).toBe(1)
    expect(report.invalidShadowPredictionCount).toBe(1)
  })

  it('an empty-string sourceMessageId is treated the same as null -- invalid/unpairable, never accepted as a real pairing key component', () => {
    const report = compareLiveRoutingEvents([
      productionEvent({ sourceMessageId: '' }),
      shadowEvent({ sourceMessageId: '' }),
    ])
    expect(report.eligiblePairs).toBe(0)
    expect(report.invalidProductionLabelCount).toBe(1)
    expect(report.invalidShadowPredictionCount).toBe(1)
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
