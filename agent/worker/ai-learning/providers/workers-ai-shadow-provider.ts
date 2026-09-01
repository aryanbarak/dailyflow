// ALF-1A (ADR-0021): the Workers AI adapter implementing
// ShadowModelProvider. NO PROVIDER FALLBACK -- if the configured Workers
// AI model fails (network error, binding throws, malformed response), the
// shadow attempt fails outright. It must NEVER substitute Gemini or the
// production text-generation provider, because that would corrupt
// model-specific evaluation provenance -- a "shadow_prediction" event's
// whole purpose is to record what a SPECIFIC configured model predicted;
// silently swapping providers on failure would make providerId/modelId/
// modelVersion lie about what actually produced the payload.
//
// modelId/modelVersion are ALWAYS the caller-supplied config values (see
// agent/worker/ai-learning/live-capture-config.ts's resolveLiveCaptureConfig)
// -- this file never hardcodes a model name, and never reads
// DEFAULT_WORKERS_AI_TEXT_MODEL (the production chat model constant) or
// any other production-provider constant. ADR-0020 Decision 11 / ADR-0021:
// the base/shadow model stays UNDECIDED and independently configured, not
// inferred from production config.

import type { WorkersAIBinding } from '../../providers/workers-ai/WorkersAITextGenerationProvider'
import {
  SHADOW_ROUTING_MAX_OUTPUT_TOKENS,
  SHADOW_ROUTING_SYSTEM_PROMPT,
  SHADOW_ROUTING_TEMPERATURE,
  buildShadowRoutingUserTurn,
  parseShadowRoutingOutput,
} from '../shadow-routing-prompt'
import type {
  ShadowModelProvider,
  ShadowRoutingPredictionRequest,
  ShadowRoutingPredictionResult,
} from '../shadow-model-provider'

// Same Chat-Completions response shape WorkersAITextGenerationProvider.ts
// already reads (`choices[0].message.content`) -- see that file's own
// header comment for why this adapter defines its own minimal structural
// type rather than the ambient embedded `Ai` types.
interface WorkersAIChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>
}

export interface WorkersAIShadowProviderConfig {
  readonly modelId: string
  readonly modelVersion: string
}

export class WorkersAIShadowModelProvider implements ShadowModelProvider {
  readonly providerId = 'workers-ai'
  readonly modelId: string
  readonly modelVersion: string

  constructor(
    private readonly ai: WorkersAIBinding,
    config: WorkersAIShadowProviderConfig,
  ) {
    this.modelId = config.modelId
    this.modelVersion = config.modelVersion
  }

  // Never throws -- every failure mode returns { ok: false, reason },
  // matching ShadowModelProvider's own contract.
  async predictRouting(request: ShadowRoutingPredictionRequest): Promise<ShadowRoutingPredictionResult> {
    let raw: unknown
    try {
      raw = await this.ai.run(this.modelId, {
        messages: [
          { role: 'system', content: SHADOW_ROUTING_SYSTEM_PROMPT },
          { role: 'user', content: buildShadowRoutingUserTurn(request.message) },
        ],
        max_tokens: SHADOW_ROUTING_MAX_OUTPUT_TOKENS,
        temperature: SHADOW_ROUTING_TEMPERATURE,
      })
    } catch {
      // Section 7/14: never log the raw error (it could echo back request
      // content) -- the caller (live-capture.ts) logs only the bounded
      // reason this returns.
      return { ok: false, reason: 'provider_error' }
    }

    const content = (raw as WorkersAIChatCompletionResponse)?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') {
      return { ok: false, reason: 'invalid_output' }
    }

    const parsed = parseShadowRoutingOutput(content)
    if (!parsed.ok) {
      return { ok: false, reason: 'invalid_output' }
    }

    return {
      ok: true,
      payload: parsed.payload,
      providerId: this.providerId,
      modelId: this.modelId,
      modelVersion: this.modelVersion,
    }
  }
}
