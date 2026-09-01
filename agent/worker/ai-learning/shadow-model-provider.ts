// ALF-1A (ADR-0021): the provider-neutral shadow-model interface. The
// orchestration layer (live-capture.ts) depends only on this interface --
// it never knows Workers AI's (or any other provider's) request/response
// shape, matching ADR-0018's own provider-abstraction discipline for the
// production text-generation path. See
// agent/worker/ai-learning/providers/workers-ai-shadow-provider.ts for the
// current (only) adapter.
//
// ZERO RUNTIME AUTHORITY: a ShadowModelProvider's output NEVER reaches
// Task/Calendar/GitHub/Finance execution, approval, or policy. It exists
// solely to produce a `shadow_prediction` candidate for later offline
// comparison against the production label for the same turn -- see
// ADR-0020 Decision 2/3 and ADR-0021.

import type { AiLearningLanguage, IntentRoutingLearningPayloadV1 } from '../../../shared/aiLearning'

export interface ShadowRoutingPredictionRequest {
  // TRANSIENT ONLY -- see this module's own privacy rule: never persisted
  // to the ledger, never logged, never included in provenance/telemetry.
  // Passed to the provider purely because a prediction requires input.
  readonly message: string
  // Best-effort hint only (e.g. the user's own resolved settings
  // language) -- the shadow model's own `language` field in its predicted
  // payload is independent and may legitimately disagree.
  readonly languageHint?: AiLearningLanguage
  readonly schemaVersion: 'intent-routing-v1'
}

export interface ShadowRoutingPredictionSuccess {
  readonly ok: true
  readonly payload: IntentRoutingLearningPayloadV1
  readonly providerId: string
  readonly modelId: string
  readonly modelVersion: string
}

// Bounded failure reasons only -- callers log the reason, never the raw
// provider error/response (section 7/14: no prompts, no model output, no
// raw user message in telemetry).
export type ShadowRoutingPredictionFailureReason = 'provider_error' | 'invalid_output'

export interface ShadowRoutingPredictionFailure {
  readonly ok: false
  readonly reason: ShadowRoutingPredictionFailureReason
}

export type ShadowRoutingPredictionResult = ShadowRoutingPredictionSuccess | ShadowRoutingPredictionFailure

// Implementations must NEVER throw from predictRouting -- every failure
// mode (provider error, malformed/invalid model output) is returned as
// { ok: false, reason }, never an exception, so a caller can treat this
// exactly like every other best-effort ALF-1A operation without its own
// try/catch. Implementations must also NEVER fall back to a different
// provider/model on failure (section 5: "If Workers AI candidate fails,
// the shadow attempt fails" -- no substitution, ever, for any provider).
export interface ShadowModelProvider {
  readonly providerId: string
  readonly modelId: string
  readonly modelVersion: string
  predictRouting(request: ShadowRoutingPredictionRequest): Promise<ShadowRoutingPredictionResult>
}
