import { describe, expect, it } from 'vitest'
import { buildLearningCorrelationId, buildProductionLabelIdempotencyKey, buildShadowPredictionIdempotencyKey } from './correlation'

// J. same source message -> stable correlation/idempotency keys.
describe('correlation/idempotency key builders (section 9)', () => {
  it('J: the same sourceMessageId always produces the same correlationId, called repeatedly', () => {
    const sourceMessageId = 'a1b2c3d4-0000-0000-0000-000000000000'
    const first = buildLearningCorrelationId(sourceMessageId)
    for (let i = 0; i < 10; i++) {
      expect(buildLearningCorrelationId(sourceMessageId)).toBe(first)
    }
  })

  it('follows the documented ai-learning:chat:<sourceMessageId> shape', () => {
    expect(buildLearningCorrelationId('abc-123')).toBe('ai-learning:chat:abc-123')
  })

  it('two different sourceMessageIds produce two different correlationIds', () => {
    expect(buildLearningCorrelationId('a')).not.toBe(buildLearningCorrelationId('b'))
  })

  it('production-label idempotency key is deterministic and follows <correlationId>:production-label:intent-routing-v1', () => {
    const correlationId = buildLearningCorrelationId('abc-123')
    expect(buildProductionLabelIdempotencyKey(correlationId)).toBe('ai-learning:chat:abc-123:production-label:intent-routing-v1')
    expect(buildProductionLabelIdempotencyKey(correlationId)).toBe(buildProductionLabelIdempotencyKey(correlationId))
  })

  it('shadow idempotency key is deterministic and includes provider/model/version provenance', () => {
    const correlationId = buildLearningCorrelationId('abc-123')
    const key = buildShadowPredictionIdempotencyKey(correlationId, 'workers-ai', '@cf/some-org/model', '2026-09-01')
    expect(key).toBe('ai-learning:chat:abc-123:shadow:workers-ai:@cf/some-org/model:2026-09-01')
    expect(buildShadowPredictionIdempotencyKey(correlationId, 'workers-ai', '@cf/some-org/model', '2026-09-01')).toBe(key)
  })

  it('shadow idempotency keys differ across provider/model/version -- a different model is a genuinely different event, never a duplicate', () => {
    const correlationId = buildLearningCorrelationId('abc-123')
    const base = buildShadowPredictionIdempotencyKey(correlationId, 'workers-ai', 'model-a', 'v1')
    expect(buildShadowPredictionIdempotencyKey(correlationId, 'workers-ai', 'model-b', 'v1')).not.toBe(base)
    expect(buildShadowPredictionIdempotencyKey(correlationId, 'workers-ai', 'model-a', 'v2')).not.toBe(base)
    expect(buildShadowPredictionIdempotencyKey(correlationId, 'gemini', 'model-a', 'v1')).not.toBe(base)
  })

  it('production-label and shadow-prediction idempotency keys for the same turn are always distinct', () => {
    const correlationId = buildLearningCorrelationId('abc-123')
    const productionKey = buildProductionLabelIdempotencyKey(correlationId)
    const shadowKey = buildShadowPredictionIdempotencyKey(correlationId, 'workers-ai', 'model-a', 'v1')
    expect(productionKey).not.toBe(shadowKey)
  })
})
