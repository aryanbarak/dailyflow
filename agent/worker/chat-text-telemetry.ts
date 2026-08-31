// Chat V2 Slice 1 -- structured diagnostics for the /chat text lane.
//
// ENG-06f measured 11-14s plain-chat turns and then had to reverse-engineer
// which provider even ran, because the text lane logged only finishReason +
// text length (and a hardcoded "to Gemini" that was wrong whenever
// AI_TEXT_PROVIDER selected Workers AI). This module is the fix's shape:
// one pure formatter that emits a single, greppable line per text call with
// the fields ENG-06f said were missing -- correlation id, provider, model,
// elapsed ms, finish reason, token counts when the provider reported them,
// and whether the fallback chain fired.
//
// SECURITY CONTRACT (Slice 1 section 8): this line must NEVER carry message
// contents, prompts, memory, API keys, or bearer tokens. That is enforced
// structurally -- ChatTextTelemetry has no field that could hold free text,
// every value is an id/enum/number, and formatChatTextTelemetryLine only
// serializes the fields named below. chat-text-telemetry.test.ts pins this.
//
// Pure functions only: no fetch, no env mutation, no console -- the caller
// (callGeminiChat in index.ts) decides where the line goes. That keeps this
// testable the same way resolveChatTurnOutcome is testable client-side.

export type ChatTextLane = 'fast' | 'legacy'

export interface ChatTextTelemetry {
  // Server-generated per-turn correlation id (crypto.randomUUID()); ties
  // this line to the same turn's other log lines. Never client-supplied.
  requestId: string
  lane: ChatTextLane
  // From TextGenerationResult.providerId -- stamped by whichever concrete
  // adapter actually answered, so a fallback-served result reports the
  // secondary, not the configured primary.
  providerId?: string
  model?: string
  elapsedMs: number
  finishReason: 'stop' | 'length' | 'other'
  promptTokens?: number
  responseTokens?: number
  fallbackUsed: boolean | 'unknown'
}

// Which provider is the PRIMARY for this specific request, given how the
// call site configured createProviders. Mirrors buildTextProvider's own
// selection rules exactly (pin/prefer force Gemini; otherwise the
// deployment's AI_TEXT_PROVIDER decides) so fallbackUsed can be derived by
// comparing the answering provider against this expectation.
export function resolveExpectedPrimaryProviderId(
  env: { AI_TEXT_PROVIDER?: string },
  options: { pinnedToGemini?: boolean; preferGemini?: boolean } = {},
): 'gemini' | 'workers-ai' {
  if (options.pinnedToGemini || options.preferGemini) return 'gemini'
  return env.AI_TEXT_PROVIDER === 'workers-ai' ? 'workers-ai' : 'gemini'
}

export function resolveFallbackUsed(
  answeringProviderId: string | undefined,
  expectedPrimaryProviderId: 'gemini' | 'workers-ai',
): boolean | 'unknown' {
  // An adapter that predates the diagnostics fields (or a test double)
  // reports nothing -- 'unknown' is more honest than defaulting to false.
  if (answeringProviderId === undefined) return 'unknown'
  return answeringProviderId !== expectedPrimaryProviderId
}

export function formatChatTextTelemetryLine(t: ChatTextTelemetry): string {
  return (
    `[ChatTextLane] requestId=${t.requestId}` +
    ` lane=${t.lane}` +
    ` provider=${t.providerId ?? 'unknown'}` +
    ` model=${t.model ?? 'unknown'}` +
    ` elapsedMs=${t.elapsedMs}` +
    ` finishReason=${t.finishReason}` +
    ` promptTokens=${t.promptTokens ?? 'n/a'}` +
    ` responseTokens=${t.responseTokens ?? 'n/a'}` +
    ` fallbackUsed=${t.fallbackUsed}`
  )
}
