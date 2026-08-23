import { describe, expect, it } from 'vitest'
import { createProviders } from './createProviders'
import { GeminiTextGenerationProvider } from './gemini/GeminiTextGenerationProvider'
import { GeminiStructuredGenerationProvider } from './gemini/GeminiStructuredGenerationProvider'
import { GeminiEmbeddingProvider } from './gemini/GeminiEmbeddingProvider'

const ENV = { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-3.6-flash', SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_KEY: 'service-key' }

describe('createProviders', () => {
  it('returns text, structured, and embedding providers, each the real Gemini adapter class (ADR-0018 S1/S2/S3)', () => {
    const providers = createProviders(ENV)

    expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
    expect(providers.structured).toBeInstanceOf(GeminiStructuredGenerationProvider)
    expect(providers.embedding).toBeInstanceOf(GeminiEmbeddingProvider)
  })

  it('every provider carries id "gemini"', () => {
    const providers = createProviders(ENV)

    expect(providers.text.id).toBe('gemini')
    expect(providers.structured.id).toBe('gemini')
    expect(providers.embedding.id).toBe('gemini')
  })
})
