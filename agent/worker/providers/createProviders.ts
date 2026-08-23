// SmartFlow -- ADR-0018 S1. One factory, so call sites depend on "the
// provider set for this env" rather than importing a concrete Gemini
// class directly -- swapping/adding a provider later (S2 structured, S3
// embedding, or ever a second TextGenerationProvider) changes this file,
// not every call site.
//
// `structured`/`embedding` are intentionally absent -- S2/S3 add them.
// Adding either now would be speculative: no adapter exists yet, and
// nothing may import a member of this factory's return shape before that
// adapter exists (see providers/types.ts's own StructuredGenerationRequest
// comment for the matching S2 note).

import { GeminiTextGenerationProvider, type GeminiProviderEnv } from './gemini/GeminiTextGenerationProvider'
import type { TextGenerationProvider } from './types'

export interface Providers {
  text: TextGenerationProvider
}

export function createProviders(env: GeminiProviderEnv, fetcher: typeof fetch = fetch): Providers {
  return {
    text: new GeminiTextGenerationProvider(env, fetcher),
  }
}
