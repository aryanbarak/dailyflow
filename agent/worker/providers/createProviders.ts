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
import type { EmbeddingProvider, StructuredGenerationProvider, TextGenerationProvider } from './types'

export interface Providers {
  text: TextGenerationProvider
  structured: StructuredGenerationProvider
  embedding: EmbeddingProvider
}

// ADR-0018 S1b: AI_TEXT_PROVIDER is per-worker-deployment config (a
// wrangler.toml [vars] entry), not per-request -- there is no fallback
// chain yet (that is S1c), so a deployment runs with exactly one
// TextGenerationProvider. `AI` is redeclared here (not
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
}

export interface CreateProvidersOptions {
  // ADR-0018 S1b work item 2: transcribePdf and /documents/analyze always
  // carry (or may carry) an attachment WorkersAITextGenerationProvider
  // cannot accept -- they pass `{ pinTextProvider: 'gemini' }` to ignore
  // AI_TEXT_PROVIDER entirely and always get Gemini, regardless of this
  // deployment's env default. Not a fallback (S1c is a separate, later
  // slice) -- a static, always-on override for call sites that structurally
  // cannot use a text-only provider.
  pinTextProvider?: 'gemini'
}

export function createProviders(
  env: CreateProvidersEnv,
  fetcher: typeof fetch = fetch,
  options: CreateProvidersOptions = {},
): Providers {
  const text: TextGenerationProvider =
    options.pinTextProvider !== 'gemini' && env.AI_TEXT_PROVIDER === 'workers-ai'
      ? new WorkersAITextGenerationProvider(env as WorkersAIProviderEnv, fetcher)
      : new GeminiTextGenerationProvider(env, fetcher)

  return {
    text,
    structured: new GeminiStructuredGenerationProvider(env, fetcher),
    embedding: new GeminiEmbeddingProvider(env, fetcher),
  }
}
