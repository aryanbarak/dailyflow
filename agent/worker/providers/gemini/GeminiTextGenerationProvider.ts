// SmartFlow -- ADR-0018 S1: the first concrete adapter. Implements
// TextGenerationProvider by wrapping exactly the request/response shape
// the 4 migrated [TEXT_GEN] call sites (PA-01 §2) already used via direct
// fetch -- this file OWNS that Gemini-specific translation so the call
// sites themselves stop knowing about it.
//
// Zero behavior change is the whole point of S1: every quirk below is
// copied from the call site it replaces, not redesigned. See the S1
// report for the two narrow, deliberate normalizations this adapter DOES
// make (both unification-driven, both untested by any existing suite
// because the two sites that changed shape -- briefing/callGemini and
// /documents/analyze -- had no prior test coverage at all):
//   1. Every turn now carries an explicit `role` ('model' for assistant,
//      'user' otherwise) -- the old callGemini/documents-analyze call
//      sites omitted `role` entirely on their single content entry.
//      Gemini's API documents an omitted role as defaulting to 'user' for
//      a single-turn call, so this is a no-op for the model, not a real
//      behavior change.
//   2. A multimodal attachment (providerOptions.inlineDataAttachment) is
//      always appended AFTER the turn's text part, matching
//      callGeminiChat's existing, test-verified image-attachment order.
//      transcribePdf's OLD raw fetch put its PDF part BEFORE the text
//      instruction -- flipped to match the one true adapter convention;
//      part order within a single Gemini `content` has no documented
//      semantic meaning.
//
// What this adapter deliberately does NOT do (ADR-0018 Decision 3): throw
// on a non-STOP finishReason, or on empty/missing text. Those checks stay
// in each call site, unchanged, because different call sites want
// different things to happen (callGemini/callGeminiChat throw a plain
// Error; transcribePdf throws a taxonomy-classified ProviderCallError;
// /documents/analyze doesn't throw at all -- it returns an empty answer
// with 200). The adapter only translates the transport and hands back
// whatever it found; the "was this good enough" judgment call is not the
// provider boundary's to make.

import type { ChatMessage } from '../../types'
import { ProviderUnavailableError, fetchGeminiOrThrow } from '../../provider-errors'
import { recordProviderFailure, type ProviderFailureEnv } from '../failureEvents'
import type { TextGenerationProvider, TextGenerationRequest, TextGenerationResult } from '../types'

// Extends ProviderFailureEnv (not the full agent/worker/types.ts `Env`) --
// this adapter only ever needs Gemini creds plus the two Supabase fields
// ADR-0018 Decision 6's failure-event persistence requires. Every actual
// caller's own env type (index.ts's `Env`, document-memory-extraction-
// endpoint.ts's `DocumentMemoryExtractionEnv`) already satisfies this
// structurally.
export interface GeminiProviderEnv extends ProviderFailureEnv {
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

type GeminiRole = 'user' | 'model'
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }
interface GeminiContent {
  role: GeminiRole
  parts: GeminiPart[]
}

// The one deliberate escape hatch (ADR-0018 Decision 2) -- only this
// adapter reads these keys. Not part of the public TextGenerationRequest
// contract (providerOptions is typed as an opaque
// Record<string, unknown>), so this shape can change without touching
// providers/types.ts.
interface GeminiTextProviderOptions {
  // Passed through verbatim into generationConfig.thinkingConfig -- the
  // adapter never defaults this itself (task instruction: a model-specific
  // quirk must not become adapter policy). Each call site that wants
  // thinking disabled passes `{ thinkingBudget: 0 }` explicitly, exactly
  // as it did before migration.
  thinkingConfig?: unknown
  // Appended as an inlineData part AFTER the last turn's text part -- see
  // this file's own header comment for the part-order note.
  inlineDataAttachment?: { mimeType: string; data: string }
}

function mapRole(role: ChatMessage['role']): GeminiRole {
  return role === 'assistant' ? 'model' : 'user'
}

// ADR-0018 Decision 3 note (finishReason mapping): Gemini's raw values
// include STOP, MAX_TOKENS, SAFETY, RECITATION, OTHER, and others still
// undocumented at any given SDK version -- collapsing everything besides
// STOP/MAX_TOKENS into 'other' is deliberate: callers that care about the
// distinction between "cut off for length" and "stopped for some other
// reason" (safety block, recitation block, ...) get that one bit; nobody
// downstream inspects finer-grained Gemini-specific values today, and a
// neutral contract that leaked every provider's own vocabulary would not
// be neutral.
function mapFinishReason(raw: unknown): TextGenerationResult['finishReason'] {
  if (raw === 'STOP') return 'stop'
  if (raw === 'MAX_TOKENS') return 'length'
  return 'other'
}

export class GeminiTextGenerationProvider implements TextGenerationProvider {
  readonly id = 'gemini'

  constructor(
    private readonly env: GeminiProviderEnv,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    const options = (req.providerOptions ?? {}) as GeminiTextProviderOptions

    const contents: GeminiContent[] = req.turns.map((turn) => ({
      role: mapRole(turn.role),
      parts: [{ text: turn.content }],
    }))
    if (options.inlineDataAttachment) {
      const lastContent = contents[contents.length - 1]
      // Only the last turn, and only when it is the caller's own ('user')
      // turn -- matches callGeminiChat's original guard exactly (an
      // attachment must never land on a 'model'/assistant turn).
      if (lastContent && lastContent.role === 'user') {
        lastContent.parts.push({
          inlineData: { mimeType: options.inlineDataAttachment.mimeType, data: options.inlineDataAttachment.data },
        })
      }
    }

    const generationConfig: Record<string, unknown> = {}
    if (req.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = req.maxOutputTokens
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature
    if (options.thinkingConfig !== undefined) generationConfig.thinkingConfig = options.thinkingConfig

    const body: Record<string, unknown> = { contents, generationConfig }
    if (req.system !== undefined) body.system_instruction = { parts: [{ text: req.system }] }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.env.GEMINI_MODEL}:generateContent?key=${this.env.GEMINI_API_KEY}`
    let res: Response
    try {
      res = await fetchGeminiOrThrow(
        this.fetcher,
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        'Gemini text generation',
      )
    } catch (err) {
      // ADR-0018 Decision 6 (INC-01 follow-up): persist every
      // ProviderUnavailableError -- fail-safe (recordProviderFailure never
      // throws), so this can never turn a real Gemini failure into a
      // DIFFERENT failure (a persistence error masking the original one).
      // Always re-throws the ORIGINAL error afterward, unchanged.
      if (err instanceof ProviderUnavailableError) {
        await recordProviderFailure(this.env, {
          capability: 'text_generation',
          provider_id: this.id,
          http_status: err.status,
        }, this.fetcher)
      }
      throw err
    }

    const data = await res.json() as {
      candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown }> } }>
    }
    const candidate = data?.candidates?.[0]
    const text = typeof candidate?.content?.parts?.[0]?.text === 'string' ? candidate.content.parts[0].text : ''
    const finishReason = mapFinishReason(candidate?.finishReason)

    return { text, finishReason }
  }
}
