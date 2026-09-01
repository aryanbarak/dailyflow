// ALF-1A (ADR-0021): deterministic correlation/idempotency key builders
// for live-captured learning events. All three functions are pure string
// formatting -- no I/O, no randomness -- so the SAME source message
// always produces the SAME keys, called once or a hundred times (section
// 9's own requirement). This is what lets ALF-0's existing reconciliation
// (agent/worker/ai-learning/learning-ledger.ts's appendAiLearningEvent)
// treat a retried capture as an idempotent no-op instead of a duplicate
// row or a conflict.
//
// Never uses Date.now()/crypto.randomUUID() as identity once a durable
// source message id exists -- that would make every retry look like a
// brand-new event instead of the same one, defeating idempotency entirely.

export function buildLearningCorrelationId(sourceMessageId: string): string {
  return `ai-learning:chat:${sourceMessageId}`
}

export function buildProductionLabelIdempotencyKey(correlationId: string): string {
  return `${correlationId}:production-label:intent-routing-v1`
}

// Model provenance is part of the key itself -- a shadow prediction from
// a DIFFERENT provider/model/version for the same turn is a genuinely
// distinct event (different candidate to compare against the same gold
// turn), never a duplicate of one from another model.
export function buildShadowPredictionIdempotencyKey(
  correlationId: string,
  providerId: string,
  modelId: string,
  modelVersion: string,
): string {
  return `${correlationId}:shadow:${providerId}:${modelId}:${modelVersion}`
}
