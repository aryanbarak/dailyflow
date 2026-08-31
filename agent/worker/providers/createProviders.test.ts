import { describe, expect, it, vi } from 'vitest'
import { createProviders } from './createProviders'
import { GeminiTextGenerationProvider } from './gemini/GeminiTextGenerationProvider'
import { GeminiStructuredGenerationProvider } from './gemini/GeminiStructuredGenerationProvider'
import { GeminiEmbeddingProvider } from './gemini/GeminiEmbeddingProvider'
import { WorkersAITextGenerationProvider, type WorkersAIBinding } from './workers-ai/WorkersAITextGenerationProvider'
import { FallbackTextGenerationProvider } from './fallbackTextProvider'

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

  // ADR-0018 S1c: AI_TEXT_FALLBACK opts a deployment into the two-provider
  // text chain. Default off; only `.text` is ever affected.
  describe('AI_TEXT_FALLBACK (ADR-0018 S1c)', () => {
    const AI: WorkersAIBinding = { run: vi.fn() }

    it('defaults to off -- .text is the plain single provider, not wrapped, when AI_TEXT_FALLBACK is absent', () => {
      const providers = createProviders({ ...ENV, AI })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
      expect(providers.text).not.toBeInstanceOf(FallbackTextGenerationProvider)
    })

    it('any value other than exactly "on" (e.g. a typo) leaves .text unwrapped', () => {
      const providers = createProviders({ ...ENV, AI, AI_TEXT_FALLBACK: 'true' })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
      expect(providers.text).not.toBeInstanceOf(FallbackTextGenerationProvider)
    })

    it('AI_TEXT_FALLBACK: "on" wraps .text in FallbackTextGenerationProvider', () => {
      const providers = createProviders({ ...ENV, AI, AI_TEXT_FALLBACK: 'on' })
      expect(providers.text).toBeInstanceOf(FallbackTextGenerationProvider)
    })

    it('order from AI_TEXT_PROVIDER: default (gemini) -- primary is Gemini, secondary is Workers AI (id reflects gemini->workers-ai)', () => {
      const providers = createProviders({ ...ENV, AI, AI_TEXT_FALLBACK: 'on' })
      expect(providers.text.id).toBe('fallback(gemini->workers-ai)')
    })

    it('order from AI_TEXT_PROVIDER: "workers-ai" -- primary is Workers AI, secondary is Gemini (id reflects workers-ai->gemini)', () => {
      const providers = createProviders({ ...ENV, AI, AI_TEXT_PROVIDER: 'workers-ai', AI_TEXT_FALLBACK: 'on' })
      expect(providers.text.id).toBe('fallback(workers-ai->gemini)')
    })

    it('pinTextProvider bypasses the fallback wrapper entirely, even when AI_TEXT_FALLBACK is "on"', () => {
      const providers = createProviders({ ...ENV, AI, AI_TEXT_FALLBACK: 'on' }, fetch, { pinTextProvider: 'gemini' })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
      expect(providers.text).not.toBeInstanceOf(FallbackTextGenerationProvider)
    })

    it('pinTextProvider bypasses preferTextProvider considerations too -- still the plain Gemini adapter', () => {
      const providers = createProviders({ ...ENV, AI, AI_TEXT_PROVIDER: 'workers-ai', AI_TEXT_FALLBACK: 'on' }, fetch, { pinTextProvider: 'gemini', preferTextProvider: 'gemini' })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
      expect(providers.text).not.toBeInstanceOf(FallbackTextGenerationProvider)
    })

    it('.structured and .embedding stay the plain Gemini adapters, never wrapped, when AI_TEXT_FALLBACK is "on"', () => {
      const providers = createProviders({ ...ENV, AI, AI_TEXT_FALLBACK: 'on' })
      expect(providers.structured).toBeInstanceOf(GeminiStructuredGenerationProvider)
      expect(providers.embedding).toBeInstanceOf(GeminiEmbeddingProvider)
      // Neither capability exposes a `generateText` method, so there is no
      // way for either to structurally BE a FallbackTextGenerationProvider
      // (a compile-time guarantee, not just this runtime instanceof check)
      // -- asserted directly as the task's own "structured path never
      // touches the fallback wrapper" guard.
      expect(providers.structured).not.toBeInstanceOf(FallbackTextGenerationProvider)
      expect(providers.embedding).not.toBeInstanceOf(FallbackTextGenerationProvider)
    })
  })

  // Chat V2 Slice 1: preferTextProvider makes Gemini the PRIMARY for one
  // request while -- unlike pinTextProvider -- keeping the AI_TEXT_FALLBACK
  // chain semantics intact (the other provider becomes the secondary).
  describe('preferTextProvider (Chat V2 Slice 1)', () => {
    const AI: WorkersAIBinding = { run: vi.fn() }

    it('{ preferTextProvider: "gemini" } overrides AI_TEXT_PROVIDER: "workers-ai" -- .text is Gemini (no fallback flag)', () => {
      const providers = createProviders({ ...ENV, AI_TEXT_PROVIDER: 'workers-ai', AI }, fetch, { preferTextProvider: 'gemini' })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
      expect(providers.text.id).toBe('gemini')
    })

    it('keeps the fallback chain when AI_TEXT_FALLBACK is "on" -- primary Gemini, secondary Workers AI', () => {
      const providers = createProviders({ ...ENV, AI_TEXT_PROVIDER: 'workers-ai', AI, AI_TEXT_FALLBACK: 'on' }, fetch, { preferTextProvider: 'gemini' })
      expect(providers.text).toBeInstanceOf(FallbackTextGenerationProvider)
      expect(providers.text.id).toBe('fallback(gemini->workers-ai)')
    })

    it('is a no-op when AI_TEXT_PROVIDER already selects Gemini', () => {
      const providers = createProviders({ ...ENV, AI }, fetch, { preferTextProvider: 'gemini' })
      expect(providers.text).toBeInstanceOf(GeminiTextGenerationProvider)
    })

    it('.structured and .embedding are unaffected', () => {
      const providers = createProviders({ ...ENV, AI_TEXT_PROVIDER: 'workers-ai', AI }, fetch, { preferTextProvider: 'gemini' })
      expect(providers.structured).toBeInstanceOf(GeminiStructuredGenerationProvider)
      expect(providers.embedding).toBeInstanceOf(GeminiEmbeddingProvider)
    })
  })
})
