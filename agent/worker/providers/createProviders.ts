// SmartFlow -- ADR-0018 S1/S2. One factory, so call sites depend on "the
// provider set for this env" rather than importing a concrete Gemini
// class directly -- swapping/adding a provider later (S3 embedding, or
// ever a second TextGenerationProvider/StructuredGenerationProvider)
// changes this file, not every call site.
//
// `embedding` is intentionally absent -- S3 adds it. Adding it now would
// be speculative: no adapter exists yet, and nothing may import a member
// of this factory's return shape before that adapter exists.

import { GeminiTextGenerationProvider, type GeminiProviderEnv } from './gemini/GeminiTextGenerationProvider'
import { GeminiStructuredGenerationProvider } from './gemini/GeminiStructuredGenerationProvider'
import type { StructuredGenerationProvider, TextGenerationProvider } from './types'

export interface Providers {
  text: TextGenerationProvider
  structured: StructuredGenerationProvider
}

export function createProviders(env: GeminiProviderEnv, fetcher: typeof fetch = fetch): Providers {
  return {
    text: new GeminiTextGenerationProvider(env, fetcher),
    structured: new GeminiStructuredGenerationProvider(env, fetcher),
  }
}
