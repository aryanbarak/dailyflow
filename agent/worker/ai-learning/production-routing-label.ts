// ALF-1A (ADR-0021): the single deterministic production-label builder.
// Every field this function accepts must already be a concrete value the
// PRODUCTION /chat path itself decided -- this module never re-derives,
// infers, or guesses a field from raw message text. Call sites in
// agent/worker/index.ts pass in exactly the values production code already
// computed at each of its five distinct, deterministic outcome points
// (see index.ts's own comments at each capture call for which outcome and
// why); this function's only job is to assemble those into a validated
// IntentRoutingLearningPayloadV1 and refuse to build a payload that would
// fail shared/aiLearning.ts's own closed-schema contract.
//
// "Use the existing contract's unknown/optional representation. DO NOT
// invent precision" (task section 10): a call site that does not have a
// concrete value for a field passes it as `undefined` -- there is no
// heuristic anywhere in this file that fills in a value production code
// did not itself compute.

import {
  collectIntentRoutingLearningPayloadErrors,
  type AiLearningDomain,
  type AiLearningInteractionClass,
  type AiLearningLanguage,
  type IntentRoutingLearningPayloadV1,
} from '../../../shared/aiLearning'

export interface ProductionRoutingLabelInput {
  readonly language: AiLearningLanguage
  readonly interactionClass: AiLearningInteractionClass
  readonly domain: AiLearningDomain
  readonly intentType?: string
  readonly toolId?: string
  readonly requiresClarification: boolean
  readonly requiresApproval: boolean
}

export type BuildProductionRoutingLabelResult =
  | { ok: true; payload: IntentRoutingLearningPayloadV1 }
  | { ok: false; errors: string[] }

// Never throws. Returns { ok: false } rather than a payload that would
// fail the shared contract -- this is the ONLY gate between "production
// code's own decision" and "what gets appended to the ledger," so it must
// itself validate, not merely trust its caller.
export function buildProductionRoutingLabel(input: ProductionRoutingLabelInput): BuildProductionRoutingLabelResult {
  const payload: IntentRoutingLearningPayloadV1 = {
    schemaVersion: 'intent-routing-v1',
    language: input.language,
    interactionClass: input.interactionClass,
    domain: input.domain,
    ...(input.intentType !== undefined ? { intentType: input.intentType } : {}),
    ...(input.toolId !== undefined ? { toolId: input.toolId } : {}),
    requiresClarification: input.requiresClarification,
    requiresApproval: input.requiresApproval,
  }
  const errors = collectIntentRoutingLearningPayloadErrors(payload)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, payload }
}
