// SmartFlow -- ADR-0018 S1/S2/S3. One factory, so call sites depend on "the
// provider set for this env" rather than importing a concrete Gemini
// class directly -- swapping/adding a provider later (ever a second
// TextGenerationProvider/StructuredGenerationProvider/EmbeddingProvider)
// changes this file, not every call site.

import { GeminiTextGenerationProvider, type GeminiProviderEnv } from './gemini/GeminiTextGenerationProvider'
import { GeminiStructuredGenerationProvider } from './gemini/GeminiStructuredGenerationProvider'
import { GeminiEmbeddingProvider } from './gemini/GeminiEmbeddingProvider'
import type { EmbeddingProvider, StructuredGenerationProvider, TextGenerationProvider } from './types'

export interface Providers {
  text: TextGenerationProvider
  structured: StructuredGenerationProvider
  embedding: EmbeddingProvider
}

export function createProviders(env: GeminiProviderEnv, fetcher: typeof fetch = fetch): Providers {
  return {
    text: new GeminiTextGenerationProvider(env, fetcher),
    structured: new GeminiStructuredGenerationProvider(env, fetcher),
    embedding: new GeminiEmbeddingProvider(env, fetcher),
  }
}
