// ALF-1A (ADR-0021): the single orchestration entry point index.ts calls
// via `ctx.waitUntil(...)` for each of its five deterministic capture
// points (see index.ts's own comments at each call site). Ties together:
// correlation/idempotency (correlation.ts), the production-label builder
// (production-routing-label.ts), the append-only ledger
// (agent/worker/ai-learning/learning-ledger.ts, unchanged from ALF-0), and
// -- only when sampled in -- a ShadowModelProvider prediction.
//
// NEVER THROWS. Every step is defensively wrapped -- this function's
// entire purpose is to run AFTER the user-facing /chat response has
// already been constructed (via ctx.waitUntil, see index.ts), so nothing
// in here can ever delay, fail, or alter that response. "Learning failure
// != production failure" (ADR-0021) is enforced HERE, not merely
// documented: even an unexpected exception from a dependency is caught at
// the top level and logged, never propagated.
//
// ctx.waitUntil IS NOT A DURABLE QUEUE (section 3 / ADR-0021): it extends
// the Worker's execution lifetime for this promise, but Cloudflare gives
// no guarantee of eventual delivery -- an isolate eviction, a deploy, or a
// crash can still drop this work silently. Guaranteed-delivery completeness
// requires a separate Queue/background-infrastructure slice; this module
// is deliberately best-effort only.
//
// PRIVACY: `rawMessage` is accepted ONLY to hand to a ShadowModelProvider
// (which itself never persists it -- see shadow-model-provider.ts's own
// contract). It is NEVER included in any ai_learning_events payload,
// never logged, never part of any telemetry line this module emits.

import type { Env } from '../types'
import type { AiLearningLanguage } from '../../../shared/aiLearning'
import { appendAiLearningEvent } from './learning-ledger'
import {
  buildLearningCorrelationId,
  buildProductionLabelIdempotencyKey,
  buildShadowPredictionIdempotencyKey,
} from './correlation'
import { buildProductionRoutingLabel, type ProductionRoutingLabelInput } from './production-routing-label'
import { isSampledForShadow } from './shadow-sampling'
import type { LiveCaptureConfig } from './live-capture-config'
import type { ShadowModelProvider } from './shadow-model-provider'
import { WorkersAIShadowModelProvider } from './providers/workers-ai-shadow-provider'
import type { WorkersAIBinding } from '../providers/workers-ai/WorkersAITextGenerationProvider'

// Bounded, never the caller's own logger requirement -- console is always
// available in the Worker runtime, matching learning-ledger.ts's own
// convention (deps.logger override exists there for its own unit tests;
// this module accepts the same shape for the same reason).
export interface LiveCaptureDependencies {
  logger?: Pick<Console, 'log' | 'error'>
}

export interface CaptureProductionRoutingTurnParams {
  readonly env: Env
  readonly config: LiveCaptureConfig
  readonly userId: string
  readonly sessionId: string | null
  readonly sourceMessageId: string
  // Transient only -- see this module's own header comment. Only read by
  // a ShadowModelProvider; never appears in a ledger payload or a log line.
  readonly rawMessage: string
  readonly label: ProductionRoutingLabelInput
}

// Only 'workers-ai' has an adapter today (section 5). An unrecognized
// providerId value in config -- which resolveLiveCaptureConfig already
// allows to be any non-empty string -- fails closed to null (shadow
// disabled) rather than guessing or falling back to a different provider.
function resolveShadowModelProvider(env: Env, config: LiveCaptureConfig): ShadowModelProvider | null {
  if (!config.shadow) return null
  if (config.shadow.providerId !== 'workers-ai') return null
  return new WorkersAIShadowModelProvider(env.AI as WorkersAIBinding, {
    modelId: config.shadow.modelId,
    modelVersion: config.shadow.modelVersion,
  })
}

// Bounded-length defensive truncation for anything logged -- correlationId
// is already a short, fixed-shape synthetic string with no user content,
// but this caps it regardless so a future format change can never grow an
// unbounded log line.
function boundedForLog(value: string, maxLength = 200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

async function appendProductionLabel(
  params: CaptureProductionRoutingTurnParams,
  correlationId: string,
  logger: Pick<Console, 'log' | 'error'>,
): Promise<void> {
  const built = buildProductionRoutingLabel(params.label)
  if (!built.ok) {
    // Invented/malformed input from a caller is itself a bug worth
    // surfacing -- but never persisted, and never fatal to the turn.
    logger.error(`[AiLearning] event=production_label status=failed correlation=${boundedForLog(correlationId)} reason=invalid_label errors=${built.errors.length}`)
    return
  }

  const result = await appendAiLearningEvent(params.env, {
    userId: params.userId,
    sessionId: params.sessionId,
    sourceMessageId: params.sourceMessageId,
    correlationId,
    idempotencyKey: buildProductionLabelIdempotencyKey(correlationId),
    learningTask: 'intent_routing_v1',
    schemaVersion: 'intent-routing-v1',
    eventKind: 'production_label',
    producerType: 'deterministic_policy',
    labelConfidence: 'validated',
    payload: { ...built.payload },
  }, { logger })

  if (result.ok) {
    logger.log(`[AiLearning] event=production_label status=${result.duplicate ? 'duplicate' : 'persisted'} correlation=${boundedForLog(correlationId)}`)
  } else {
    logger.error(`[AiLearning] event=production_label status=failed correlation=${boundedForLog(correlationId)} reason=${result.error}`)
  }
}

async function runShadowPrediction(
  params: CaptureProductionRoutingTurnParams,
  correlationId: string,
  logger: Pick<Console, 'log' | 'error'>,
): Promise<void> {
  if (!params.config.shadow) {
    logger.log(`[AiShadow] status=disabled correlation=${boundedForLog(correlationId)}`)
    return
  }

  if (!isSampledForShadow(params.sourceMessageId, params.config.shadow.sampleRate)) {
    logger.log(`[AiShadow] status=sampled_out correlation=${boundedForLog(correlationId)}`)
    return
  }

  const provider = resolveShadowModelProvider(params.env, params.config)
  if (!provider) {
    // Configured providerId has no adapter -- fail closed, never fall
    // back to a different provider (section 5).
    logger.log(`[AiShadow] status=disabled correlation=${boundedForLog(correlationId)} reason=unsupported_provider provider=${boundedForLog(params.config.shadow.providerId, 60)}`)
    return
  }

  const languageHint: AiLearningLanguage | undefined = params.label.language
  const startedAt = Date.now()
  const result = await provider.predictRouting({
    message: params.rawMessage,
    languageHint,
    schemaVersion: 'intent-routing-v1',
  })
  const elapsedMs = Date.now() - startedAt

  if (!result.ok) {
    // Never logs the raw message or model response -- only the bounded
    // reason (section 7/14).
    logger.log(`[AiShadow] status=${result.reason} provider=${boundedForLog(provider.providerId, 60)} model=${boundedForLog(provider.modelId, 120)} elapsedMs=${elapsedMs}`)
    return
  }

  const appendResult = await appendAiLearningEvent(params.env, {
    userId: params.userId,
    sessionId: params.sessionId,
    sourceMessageId: params.sourceMessageId,
    correlationId,
    idempotencyKey: buildShadowPredictionIdempotencyKey(correlationId, result.providerId, result.modelId, result.modelVersion),
    learningTask: 'intent_routing_v1',
    schemaVersion: 'intent-routing-v1',
    eventKind: 'shadow_prediction',
    producerType: 'shadow_model',
    providerId: result.providerId,
    modelId: result.modelId,
    modelVersion: result.modelVersion,
    // ADR-0020: a shadow prediction is ALWAYS 'candidate' -- never
    // 'validated'/'user_confirmed'/'execution_verified', regardless of
    // how confident the model's own output looked. Enforced again here
    // even though appendAiLearningEvent/collectAiLearningEventInputErrors
    // already reject any other pairing for eventKind='shadow_prediction'
    // -- this is the value this module will ever construct, not merely
    // the value the shared validator happens to allow.
    labelConfidence: 'candidate',
    payload: { ...result.payload },
  }, { logger })

  if (appendResult.ok) {
    logger.log(`[AiShadow] status=success provider=${boundedForLog(result.providerId, 60)} model=${boundedForLog(result.modelId, 120)} elapsedMs=${elapsedMs}`)
  } else {
    logger.error(`[AiShadow] status=persist_error provider=${boundedForLog(result.providerId, 60)} model=${boundedForLog(result.modelId, 120)} elapsedMs=${elapsedMs} reason=${appendResult.error}`)
  }
}

// The single function index.ts calls, always via `ctx.waitUntil(...)`,
// always after the user-facing response is already being constructed/
// returned. Never throws.
export async function captureProductionRoutingTurn(
  params: CaptureProductionRoutingTurnParams,
  deps: LiveCaptureDependencies = {},
): Promise<void> {
  const logger = deps.logger ?? console
  if (!params.config.captureEnabled) return

  try {
    const correlationId = buildLearningCorrelationId(params.sourceMessageId)
    await appendProductionLabel(params, correlationId, logger)
    await runShadowPrediction(params, correlationId, logger)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('[AiLearning] captureProductionRoutingTurn failed unexpectedly (learning failure, not a production failure):', message)
  }
}
