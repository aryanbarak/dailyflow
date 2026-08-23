// SmartFlow -- ADR-0018 S2: implements StructuredGenerationProvider by
// wrapping exactly the request/response shape the 8 migrated
// [STRUCTURED_GEN] call sites (PA-01 §2, actually 9 distinct raw-fetch
// sites once the 4 suggestion handlers are counted individually rather
// than as one audit row -- see the S2 report) already used via direct
// fetch. Mirrors GeminiTextGenerationProvider.ts's own structure closely;
// see that file's header comment for the shared design rationale
// (fail-safe failure persistence, single-source model resolution).
//
// Zero behavior change is the point: `req.schema` (a NeutralObjectSchema)
// is translated to Gemini's dialect via
// providers/gemini/geminiSchemaTranslation.ts -- the SAME function
// shared/*.purity.test.ts proves reproduces the pre-S2 wire output
// byte-for-byte, key order included. This adapter does not throw on a
// non-STOP finishReason or on empty/missing text, matching the text
// adapter's own posture (ADR-0018 Decision 3): different call sites want
// different things to happen with an unusable response (a plain Error, a
// taxonomy-classified ProviderCallError, or a calm empty-array fallback),
// so that judgment call stays with the caller, not the provider boundary.

import { ProviderUnavailableError, fetchGeminiOrThrow } from '../../provider-errors'
import { recordProviderFailure, type ProviderFailureEnv } from '../failureEvents'
import { resolveGeminiModel } from '../../geminiModel'
import { translateNeutralSchema } from './geminiSchemaTranslation'
import type { StructuredGenerationProvider, StructuredGenerationRequest, StructuredGenerationResult } from '../types'

// Same structural-env pattern as GeminiTextGenerationProvider's own
// GeminiProviderEnv -- see that file's comment for why this extends
// ProviderFailureEnv rather than the full agent/worker/types.ts `Env`.
export interface GeminiProviderEnv extends ProviderFailureEnv {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

// The one deliberate escape hatch (ADR-0018 Decision 2), mirroring
// GeminiTextGenerationProvider's own GeminiTextProviderOptions. No
// [STRUCTURED_GEN] call site sets thinkingConfig any more after MIG-01b
// (gemini-3.6-flash rejects it outright) -- kept as a passthrough
// capability, not adapter policy, for the same reason the text adapter
// keeps it: a future model or an env-pinned gemini-2.5-flash deployment
// may still want it, and the adapter must not decide that unilaterally.
interface GeminiStructuredProviderOptions {
  thinkingConfig?: unknown
}

// NOT identical to GeminiTextGenerationProvider's own mapFinishReason:
// this one maps a MISSING finishReason to 'stop', not 'other'. Discovered
// migrating real call sites in S2 Phase C -- all four pre-S2 structured
// builders (reasoning, derivation, extraction, task-title) used the exact
// same check, `finishReason !== undefined && finishReason !== 'STOP'`,
// i.e. an ABSENT finishReason was always treated as fine, never as a
// reason to reject the response. context-derivation-endpoint.test.ts's
// and personal-memory-extraction-endpoint.test.ts's own happy-path
// fixtures omit finishReason entirely and expect success -- mapping it to
// 'other' here broke both (a real regression caught by those tests, not
// a theoretical one). Kept as a separate, self-contained copy from the
// text adapter's mapFinishReason (not a shared import) precisely because
// the two capabilities' pre-existing conventions differ on this one
// point -- matching S1's own precedent of each adapter owning its
// Gemini-dialect parsing locally.
function mapFinishReason(raw: unknown): StructuredGenerationResult['finishReason'] {
  if (raw === undefined || raw === 'STOP') return 'stop'
  if (raw === 'MAX_TOKENS') return 'length'
  return 'other'
}

export class GeminiStructuredGenerationProvider implements StructuredGenerationProvider {
  readonly id = 'gemini'

  constructor(
    private readonly env: GeminiProviderEnv,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generateStructured(req: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
    const options = (req.providerOptions ?? {}) as GeminiStructuredProviderOptions

    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      responseSchema: translateNeutralSchema(req.schema),
    }
    if (req.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = req.maxOutputTokens
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature
    if (options.thinkingConfig !== undefined) generationConfig.thinkingConfig = options.thinkingConfig

    const body: Record<string, unknown> = {
      contents: req.turns.map((turn) => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.content }] })),
      generationConfig,
    }
    if (req.system !== undefined) body.system_instruction = { parts: [{ text: req.system }] }

    // MIG-01b: single-source model resolution (geminiModel.ts).
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolveGeminiModel(this.env)}:generateContent?key=${this.env.GEMINI_API_KEY}`
    let res: Response
    try {
      res = await fetchGeminiOrThrow(
        this.fetcher,
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        'Gemini structured generation',
      )
    } catch (err) {
      // ADR-0018 Decision 6: same fail-safe persistence as the text
      // adapter, capability='structured_generation' this time. Always
      // re-throws the ORIGINAL error afterward, unchanged.
      if (err instanceof ProviderUnavailableError) {
        await recordProviderFailure(this.env, {
          capability: 'structured_generation',
          provider_id: this.id,
          http_status: err.status,
        }, this.fetcher)
      }
      throw err
    }

    const data = await res.json() as {
      candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown }> } }>
      usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown }
    }
    const candidate = data?.candidates?.[0]
    const rawText = typeof candidate?.content?.parts?.[0]?.text === 'string' ? candidate.content.parts[0].text : ''
    const finishReason = mapFinishReason(candidate?.finishReason)
    // ADR-0018 S2 amendment (2026-08-23): promptTokens/responseTokens are
    // real, currently-persisted data at 2 of the 9 migrated call sites
    // (cost/usage tracking) -- see StructuredGenerationResult's own
    // comment. Only included when Gemini actually sent usageMetadata.
    const promptTokens = typeof data?.usageMetadata?.promptTokenCount === 'number' ? data.usageMetadata.promptTokenCount : undefined
    const responseTokens = typeof data?.usageMetadata?.candidatesTokenCount === 'number' ? data.usageMetadata.candidatesTokenCount : undefined
    const usage = promptTokens !== undefined || responseTokens !== undefined ? { promptTokens, responseTokens } : undefined
    // ADR-0018 S2 amendment (2026-08-23): the untranslated provider value,
    // for the 2 call sites that persist it verbatim (existing tests assert
    // on the literal string) -- see StructuredGenerationResult's own
    // comment for why this exists alongside the neutral `finishReason`.
    const rawFinishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason : undefined

    return { rawText, finishReason, ...(usage ? { usage } : {}), ...(rawFinishReason !== undefined ? { rawFinishReason } : {}) }
  }
}
