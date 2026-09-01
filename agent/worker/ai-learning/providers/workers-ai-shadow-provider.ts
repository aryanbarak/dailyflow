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

// ALF-1A correction (round 2, item 2): the Workers AI catalog has at
// least two relevant output shapes for a text-generation-style model --
// see this file's own predictRouting comment on `extractResponseContent`
// for the exact precedence. This structural type covers BOTH, matching
// WorkersAITextGenerationProvider.ts's own `choices[0].message.content`
// reading plus the bespoke `{ response: "..." }` shape some candidate
// families (e.g. Qwen-family models) use -- see that file's own header
// comment for why this adapter defines its own minimal structural type
// rather than the ambient embedded `Ai` types.
interface WorkersAIRunResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  response?: string | null
}

export interface WorkersAIShadowProviderConfig {
  readonly modelId: string
  readonly modelVersion: string
}

// Tries the OpenAI-compatible Chat-Completions shape first (today's only
// previously-supported shape), then the bespoke completion shape some
// Workers AI candidate families use instead -- NEVER a provider/model
// fallback (both are two documented string locations within the SAME
// single env.AI.run response for the ONE configured model; this is not a
// retry and never queries a second model). An unrecognized/missing shape
// in both locations returns null, mapped to `invalid_output` by the
// caller below -- never a thrown error, never a guess.
function extractResponseContent(raw: unknown): string | null {
  const typed = raw as WorkersAIRunResponse
  const chatCompletionContent = typed?.choices?.[0]?.message?.content
  if (typeof chatCompletionContent === 'string' && chatCompletionContent.trim() !== '') {
    return chatCompletionContent
  }
  const bespokeContent = typed?.response
  if (typeof bespokeContent === 'string' && bespokeContent.trim() !== '') {
    return bespokeContent
  }
  return null
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

    const content = extractResponseContent(raw)
    if (content === null) {
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
