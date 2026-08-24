// SmartFlow -- ADR-0018 S1/S2/S3. One factory, so call sites depend on "the
// provider set for this env" rather than importing a concrete Gemini
// class directly -- swapping/adding a provider later (ever a second
// TextGenerationProvider/StructuredGenerationProvider/EmbeddingProvider)
// changes this file, not every call site.

import { GeminiTextGenerationProvider, type GeminiProviderEnv } from './gemini/GeminiTextGenerationProvider'
import { GeminiStructuredGenerationProvider } from './gemini/GeminiStructuredGenerationProvider'
import { GeminiEmbeddingProvider } from './gemini/GeminiEmbeddingProvider'
// ADR-0018 S1b: second TextGenerationProvider. Structured generation and
// embeddings stay Gemini-only (ADR-0018 Decision 5) -- only `.text` is
// selectable below.
import { WorkersAITextGenerationProvider, type WorkersAIBinding, type WorkersAIProviderEnv } from './workers-ai/WorkersAITextGenerationProvider'
// ADR-0018 S1c: the fallback chain Decision 5 named as a future slice for
// text generation only -- `.structured`/`.embedding` never touch this
// import at all (see the two return-statement branches below, both of
// which construct them identically regardless of AI_TEXT_FALLBACK).
import { FallbackTextGenerationProvider } from './fallbackTextProvider'
import type { EmbeddingProvider, StructuredGenerationProvider, TextGenerationProvider } from './types'

export interface Providers {
  text: TextGenerationProvider
  structured: StructuredGenerationProvider
  embedding: EmbeddingProvider
}

// ADR-0018 S1b: AI_TEXT_PROVIDER is per-worker-deployment config (a
// wrangler.toml [vars] entry), not per-request. By default (AI_TEXT_FALLBACK
// unset/off) a deployment still runs with exactly one TextGenerationProvider;
// S1c's AI_TEXT_FALLBACK adds an opt-in two-provider chain -- see that
// field's own comment below. `AI` is redeclared here (not
// `Partial<WorkersAIProviderEnv>`, which TS2320-conflicts with
// GeminiProviderEnv over their shared ProviderFailureEnv fields'
// optionality) as its own optional field: most callers of
// createProviders() (task-title-extraction.ts,
// personal-memory-extraction-endpoint.ts, ...) only ever exercise
// .structured/.embedding and pass their own narrower env shape that has no
// AI field at all -- that stays valid as long as AI_TEXT_PROVIDER isn't
// 'workers-ai' for them.
export interface CreateProvidersEnv extends GeminiProviderEnv {
  AI?: WorkersAIBinding
  AI_TEXT_PROVIDER?: string
  // ADR-0018 S1c: 'on' wraps `.text` in FallbackTextGenerationProvider;
  // any other value (including absent, the default) leaves `.text` as the
  // single provider AI_TEXT_PROVIDER already selects -- unchanged from
  // S1b. Only `.text` is ever affected; see the Decision 5 table in the
  // ADR (structured generation and embeddings fail closed, no exceptions).
  AI_TEXT_FALLBACK?: string
}

export interface CreateProvidersOptions {
  // ADR-0018 S1b work item 2: transcribePdf and /documents/analyze always
  // carry (or may carry) an attachment WorkersAITextGenerationProvider
  // cannot accept -- they pass `{ pinTextProvider: 'gemini' }` to ignore
  // AI_TEXT_PROVIDER entirely and always get Gemini, regardless of this
  // deployment's env default. ADR-0018 S1c: this bypasses the fallback
  // wrapper too, not just provider selection -- an attachment request is
  // pinned straight to a plain GeminiTextGenerationProvider (see the
  // `pinTextProvider === 'gemini'` early return below), the same
  // structural reason WorkersAITextGenerationProvider itself is never
  // reachable for these call sites: an attachment cannot be retried
  // against a text-only secondary either.
  pinTextProvider?: 'gemini'
}

export function createProviders(
  env: CreateProvidersEnv,
  fetcher: typeof fetch = fetch,
  options: CreateProvidersOptions = {},
): Providers {
  return {
    text: buildTextProvider(env, fetcher, options),
    structured: new GeminiStructuredGenerationProvider(env, fetcher),
    embedding: new GeminiEmbeddingProvider(env, fetcher),
  }
}

function buildTextProvider(
  env: CreateProvidersEnv,
  fetcher: typeof fetch,
  options: CreateProvidersOptions,
): TextGenerationProvider {
  // Attachment pinning bypasses provider selection AND the fallback
  // wrapper entirely (ADR-0018 S1b/S1c) -- an attachment-carrying request
  // always gets exactly one plain Gemini call, never a chain.
  if (options.pinTextProvider === 'gemini') {
    return new GeminiTextGenerationProvider(env, fetcher)
  }

  const wantsWorkersAI = env.AI_TEXT_PROVIDER === 'workers-ai'
  const gemini = () => new GeminiTextGenerationProvider(env, fetcher)
  const workersAI = () => new WorkersAITextGenerationProvider(env as WorkersAIProviderEnv, fetcher)

  if (env.AI_TEXT_FALLBACK === 'on') {
    // ADR-0018 S1c: "order from AI_TEXT_PROVIDER" -- whichever provider
    // AI_TEXT_PROVIDER already selects is the primary; the OTHER one (the
    // only other TextGenerationProvider that exists today) is the
    // secondary. Structured/embedding are constructed above, outside this
    // function, and never pass through here at all.
    const primary: TextGenerationProvider = wantsWorkersAI ? workersAI() : gemini()
    const secondary: TextGenerationProvider = wantsWorkersAI ? gemini() : workersAI()
    return new FallbackTextGenerationProvider(primary, secondary, env, fetcher)
  }

  return wantsWorkersAI ? workersAI() : gemini()
}
