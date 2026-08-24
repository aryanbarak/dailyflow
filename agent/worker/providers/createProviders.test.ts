import { describe, expect, it, vi } from 'vitest'
import { createProviders } from './createProviders'
import { GeminiTextGenerationProvider } from './gemini/GeminiTextGenerationProvider'
import { GeminiStructuredGenerationProvider } from './gemini/GeminiStructuredGenerationProvider'
import { GeminiEmbeddingProvider } from './gemini/GeminiEmbeddingProvider'
import { WorkersAITextGenerationProvider, type WorkersAIBinding } from './workers-ai/WorkersAITextGenerationProvider'

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

  // ADR-0018 S1b: AI_TEXT_PROVIDER selects ONLY .text -- .structured and
  // .embedding stay Gemini-only regardless (Decision 5).
  describe('AI_TEXT_PROVIDER selection (ADR-0018 S1b)', () => {
    it('defaults .text to Gemini when AI_TEXT_PROVIDER is absent', () => {
      const providers = createProviders(ENV)
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
    })

    it('defaults .text to Gemini for any value other than exactly "workers-ai" (e.g. a typo)', () => {
      const providers = createProviders({ ...ENV, AI_TEXT_PROVIDER: 'Workers-AI' })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
    })

    it('selects .text as WorkersAITextGenerationProvider when AI_TEXT_PROVIDER is "workers-ai"', () => {
      const AI: WorkersAIBinding = { run: vi.fn() }
      const providers = createProviders({ ...ENV, AI_TEXT_PROVIDER: 'workers-ai', AI })
      expect(providers.text).toBeInstanceOf(WorkersAITextGenerationProvider)
      expect(providers.text.id).toBe('workers-ai')
    })

    it('.structured and .embedding stay the Gemini adapters even when AI_TEXT_PROVIDER is "workers-ai"', () => {
      const AI: WorkersAIBinding = { run: vi.fn() }
      const providers = createProviders({ ...ENV, AI_TEXT_PROVIDER: 'workers-ai', AI })
      expect(providers.structured).toBeInstanceOf(GeminiStructuredGenerationProvider)
      expect(providers.embedding).toBeInstanceOf(GeminiEmbeddingProvider)
    })
  })

  // ADR-0018 S1b work item 2: transcribePdf and /documents/analyze pass
  // this to stay on Gemini regardless of the deployment's own
  // AI_TEXT_PROVIDER value -- both call sites can carry an attachment,
  // which WorkersAITextGenerationProvider always rejects.
  describe('pinTextProvider (ADR-0018 S1b)', () => {
    it('{ pinTextProvider: "gemini" } overrides AI_TEXT_PROVIDER: "workers-ai" -- .text is still Gemini', () => {
      const AI: WorkersAIBinding = { run: vi.fn() }
      const providers = createProviders({ ...ENV, AI_TEXT_PROVIDER: 'workers-ai', AI }, fetch, { pinTextProvider: 'gemini' })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
    })

    it('is a no-op when AI_TEXT_PROVIDER is already "gemini" (or absent)', () => {
      const providers = createProviders(ENV, fetch, { pinTextProvider: 'gemini' })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
    })
  })
})
