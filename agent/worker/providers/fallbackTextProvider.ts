// SmartFlow -- ADR-0018 S1c: the fallback text-generation chain. Decision 5
// allows text generation (and ONLY text generation) to degrade to a
// weaker/alternate provider on failure; structured generation and
// embeddings stay fail-closed, untouched by this file. Wraps exactly two
// TextGenerationProviders -- primary and secondary -- and implements the
// SAME TextGenerationProvider interface, so a caller that receives this
// wrapper from createProviders() sees no shape difference from a single
// concrete provider.
//
// Trigger discipline (S1c task instruction): fallback fires ONLY on
// ProviderUnavailableError -- the primary's transport failing to produce a
// response at all (network error, 429, 5xx, or a Workers AI binding
// throw -- see provider-errors.ts and WorkersAITextGenerationProvider's own
// header comment). A model that ANSWERS, even badly (empty text, wrong
// language, a non-STOP finishReason), is not a trigger -- that judgment
// stays exactly where ADR-0018 Decision 3 already puts it (the call site,
// not the provider boundary); this wrapper never inspects a successful
// TextGenerationResult's own content.
//
// One fallback attempt only: if the secondary ALSO throws
// ProviderUnavailableError, this wrapper does not retry either provider
// again -- it lets that second error propagate unchanged. The secondary's
// own adapter has already called recordProviderFailure for it (same as the
// primary's), and every existing `err instanceof ProviderUnavailableError`
// catch downstream (index.ts's 503 PROVIDER_UNAVAILABLE responses) already
// handles a propagated ProviderUnavailableError correctly -- this wrapper
// adds no new error type and no new user-facing message. No "answered by
// backup model" annotation is added anywhere (S1c task instruction) --
// TextGenerationResult carries no such field, and this wrapper does not
// invent one.
import { ProviderUnavailableError } from '../provider-errors'
import { recordFallbackSuccess, type ProviderFailureEnv } from './failureEvents'
import type { TextGenerationProvider, TextGenerationRequest, TextGenerationResult } from './types'

export class FallbackTextGenerationProvider implements TextGenerationProvider {
  // Diagnostic only -- nothing in this codebase branches on `.text.id`
  // today (grep-verified against providers/createProviders.test.ts, the
  // only place `.text.id` is asserted, none of which exercise this
  // wrapper). Composed from both real ids rather than aliased to either
  // one alone, since a fallback chain's identity genuinely differs from
  // either single provider's.
  readonly id: string

  constructor(
    private readonly primary: TextGenerationProvider,
    private readonly secondary: TextGenerationProvider,
    private readonly env: ProviderFailureEnv,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.id = `fallback(${primary.id}->${secondary.id})`
  }

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    try {
      return await this.primary.generateText(req)
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err

      const result = await this.secondary.generateText(req)
      // Reached only when the secondary did NOT throw -- a second
      // ProviderUnavailableError from the secondary propagates out of the
      // `await` above and skips this call entirely, exactly as the
      // "one attempt, then honest PROVIDER_UNAVAILABLE" rule requires.
      await recordFallbackSuccess(
        this.env,
        { capability: 'text_generation', provider_id: this.secondary.id },
        this.fetcher,
      )
      return result
    }
  }
}
