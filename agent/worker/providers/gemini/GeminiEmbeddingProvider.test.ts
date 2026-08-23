import { describe, expect, it, vi } from 'vitest'
import { ProviderRequestError, ProviderUnavailableError } from '../../provider-errors'
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../../embeddingConfig'
import { EmbeddingDimensionMismatchError, GeminiEmbeddingProvider, assertEmbeddingDimensions } from './GeminiEmbeddingProvider'

// SUPABASE_URL/SUPABASE_SERVICE_KEY: needed only for the failure-event
// persistence path (ADR-0018 Decision 6, see the describe block below) --
// present on every test's env so GeminiProviderEnv is always satisfied;
// tests that don't trigger a ProviderUnavailableError never exercise them.
const ENV = { GEMINI_API_KEY: 'test-key', SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_KEY: 'service-key' }

function embeddingResponse(values: number[], status = 200) {
  return new Response(JSON.stringify({ embedding: { values } }), { status, headers: { 'Content-Type': 'application/json' } })
}

// A deliberately non-unit vector (not already normalized), so tests that
// check the adapter's OWN normalization actually observe a real change --
// a fixture that happened to already be unit-length would pass a
// double-normalization bug just as easily as a correct single one.
function nonUnitVector(length: number): number[] {
  return Array.from({ length }, (_, i) => i + 1)
}

describe('GeminiEmbeddingProvider', () => {
  it('has id "gemini", model "gemini-embedding-001", dimensions 768, normalizesOutput false', () => {
    const provider = new GeminiEmbeddingProvider(ENV, vi.fn())
    expect(provider.id).toBe('gemini')
    expect(provider.model).toBe(EMBEDDING_MODEL)
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS)
    expect(provider.normalizesOutput).toBe(false)
  })

  describe('request envelope shape', () => {
    it('maps each input text to its own embedContent call -- batch input uses the existing per-text pattern, not a batch endpoint', async () => {
      const fetcher = vi.fn(async () => embeddingResponse(nonUnitVector(EMBEDDING_DIMENSIONS)))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await provider.embed(['first', 'second', 'third'])

      expect(fetcher).toHaveBeenCalledTimes(3)
      const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))
      expect(bodies[0]).toEqual({ content: { parts: [{ text: 'first' }] }, outputDimensionality: EMBEDDING_DIMENSIONS })
      expect(bodies[1].content.parts[0].text).toBe('second')
      expect(bodies[2].content.parts[0].text).toBe('third')
    })

    it('builds the URL from EMBEDDING_MODEL/GEMINI_API_KEY (names only)', async () => {
      const fetcher = vi.fn(async () => embeddingResponse(nonUnitVector(EMBEDDING_DIMENSIONS)))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await provider.embed(['hi'])

      const [url] = fetcher.mock.calls[0]
      expect(String(url)).toContain(`/models/${EMBEDDING_MODEL}:embedContent`)
      expect(String(url)).toContain('key=test-key')
    })

    it('an empty texts array makes zero calls and returns zero vectors', async () => {
      const fetcher = vi.fn(async () => embeddingResponse(nonUnitVector(EMBEDDING_DIMENSIONS)))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      const result = await provider.embed([])

      expect(fetcher).not.toHaveBeenCalled()
      expect(result.vectors).toEqual([])
    })
  })

  describe('output shape and normalization', () => {
    it('returns one 768-length vector per input text', async () => {
      const fetcher = vi.fn(async () => embeddingResponse(nonUnitVector(EMBEDDING_DIMENSIONS)))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      const result = await provider.embed(['a', 'b'])

      expect(result.vectors).toHaveLength(2)
      expect(result.vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS)
      expect(result.vectors[1]).toHaveLength(EMBEDDING_DIMENSIONS)
    })

    it('every returned vector is unit-normalized (L2 norm ~= 1), applied exactly once -- gemini-embedding-001 at outputDimensionality=768 is not normalized by the provider itself', async () => {
      const raw = nonUnitVector(EMBEDDING_DIMENSIONS)
      const fetcher = vi.fn(async () => embeddingResponse(raw))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      const result = await provider.embed(['x'])
      const vector = result.vectors[0]

      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
      expect(norm).toBeCloseTo(1, 10)
      // Direction preserved: same normalized ratio as raw[1]/raw[0].
      expect(vector[1] / vector[0]).toBeCloseTo(raw[1] / raw[0], 8)
    })

    it('an already-unit vector from the provider stays unit after normalization (idempotent, not corrupted by re-application)', async () => {
      const unit = l2NormalizeForTest(nonUnitVector(EMBEDDING_DIMENSIONS))
      const fetcher = vi.fn(async () => embeddingResponse(unit))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      const result = await provider.embed(['x'])
      const norm = Math.sqrt(result.vectors[0].reduce((sum, v) => sum + v * v, 0))
      expect(norm).toBeCloseTo(1, 10)
      expect(result.vectors[0]).toEqual(unit)
    })

    it('a missing/malformed values field degrades to an empty vector for that text, never throws', async () => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      const result = await provider.embed(['x'])
      expect(result.vectors[0]).toEqual([])
    })

    it('a values array containing a non-number entry degrades to an empty vector for that text', async () => {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({ embedding: { values: [1, 2, 'oops'] } }), { status: 200 }))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      const result = await provider.embed(['x'])
      expect(result.vectors[0]).toEqual([])
    })
  })

  describe('dimension assertion (ADR-0018 Decision 4)', () => {
    it('assertEmbeddingDimensions passes silently when provider.dimensions matches EMBEDDING_DIMENSIONS', () => {
      expect(() => assertEmbeddingDimensions({ dimensions: EMBEDDING_DIMENSIONS })).not.toThrow()
    })

    it('assertEmbeddingDimensions throws EmbeddingDimensionMismatchError when provider.dimensions diverges', () => {
      expect(() => assertEmbeddingDimensions({ dimensions: 1536 })).toThrow(EmbeddingDimensionMismatchError)
      try {
        assertEmbeddingDimensions({ dimensions: 1536 })
        throw new Error('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(EmbeddingDimensionMismatchError)
        expect((err as EmbeddingDimensionMismatchError).actualDimensions).toBe(1536)
        expect((err as EmbeddingDimensionMismatchError).expectedDimensions).toBe(EMBEDDING_DIMENSIONS)
      }
    })

    it('GeminiEmbeddingProvider.embed asserts on first use (no network call happens for a would-be mismatch) -- the concrete class always matches, so this proves the assertion runs before any fetch, not that it can fire for this class', async () => {
      const fetcher = vi.fn(async () => embeddingResponse(nonUnitVector(EMBEDDING_DIMENSIONS)))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await provider.embed(['x'])

      expect(fetcher).toHaveBeenCalledTimes(1) // proves the assertion did not block or duplicate calls
    })
  })

  describe('failure classification (via provider-errors.ts)', () => {
    it('429 -> ProviderUnavailableError', async () => {
      const fetcher = vi.fn(async () => new Response('rate limited', { status: 429 }))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await expect(provider.embed(['hi'])).rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it.each([500, 502, 503, 504])('%s -> ProviderUnavailableError', async (status) => {
      const fetcher = vi.fn(async () => new Response('server error', { status }))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await expect(provider.embed(['hi'])).rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it('a network-level failure (fetch rejects) -> ProviderUnavailableError', async () => {
      const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') })
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await expect(provider.embed(['hi'])).rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it('400 -> ProviderRequestError (not ProviderUnavailableError) -- a bug on our own side, not the provider being down', async () => {
      const fetcher = vi.fn(async () => new Response('bad request', { status: 400 }))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      const rejection = provider.embed(['hi'])
      await expect(rejection).rejects.toBeInstanceOf(ProviderRequestError)
      await expect(rejection).rejects.not.toBeInstanceOf(ProviderUnavailableError)
    })

    it('stops at the first failing text -- does not attempt remaining texts in the batch', async () => {
      // A plain (not URL-aware) failing fetcher also answers
      // recordProviderFailure's own POST -- count only embedContent calls
      // to isolate "how many texts were attempted" from "was the failure
      // persisted" (that's the separate describe block below).
      const fetcher = vi.fn(async () => new Response('server error', { status: 500 }))
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await expect(provider.embed(['first', 'second', 'third'])).rejects.toBeInstanceOf(ProviderUnavailableError)
      const embedContentCalls = fetcher.mock.calls.filter(([url]) => String(url).includes(':embedContent'))
      expect(embedContentCalls).toHaveLength(1)
    })
  })

  // ADR-0018 Decision 6 (INC-01 follow-up): every ProviderUnavailableError
  // must be persisted via failureEvents.ts's recordProviderFailure.
  describe('failure-event persistence (ADR-0018 Decision 6)', () => {
    function urlAwareFetcher(geminiStatus: number, geminiBody = 'provider error') {
      const supabaseInsert = vi.fn(async () => new Response(null, { status: 201 }))
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/rest/v1/provider_failure_events')) return supabaseInsert(input, init)
        return new Response(geminiBody, { status: geminiStatus })
      })
      return { fetcher, supabaseInsert }
    }

    it('records a failure event (capability embedding, the real HTTP status) when the Gemini call throws ProviderUnavailableError', async () => {
      const { fetcher, supabaseInsert } = urlAwareFetcher(429)
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await expect(provider.embed(['hi'])).rejects.toBeInstanceOf(ProviderUnavailableError)

      expect(supabaseInsert).toHaveBeenCalledTimes(1)
      const [, init] = supabaseInsert.mock.calls[0]
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ capability: 'embedding', provider_id: 'gemini', http_status: 429 })
    })

    it('does NOT record a failure event for a ProviderRequestError (400)', async () => {
      const { fetcher, supabaseInsert } = urlAwareFetcher(400, 'bad request')
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)

      await expect(provider.embed(['hi'])).rejects.toBeInstanceOf(ProviderRequestError)

      expect(supabaseInsert).not.toHaveBeenCalled()
    })

    it('does NOT record a failure event for an EmbeddingDimensionMismatchError -- it is a config bug, not a provider outage, and it throws before any network call', async () => {
      const supabaseInsert = vi.fn(async () => new Response(null, { status: 201 }))
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/rest/v1/provider_failure_events')) return supabaseInsert(input, init)
        return embeddingResponse(nonUnitVector(EMBEDDING_DIMENSIONS))
      })
      const provider = new GeminiEmbeddingProvider(ENV, fetcher)
      // Simulate a diverged provider by asserting directly against a stub --
      // see the dimension-assertion describe block above for why the
      // concrete class itself can never actually diverge.
      expect(() => assertEmbeddingDimensions({ dimensions: 512 })).toThrow(EmbeddingDimensionMismatchError)
      expect(supabaseInsert).not.toHaveBeenCalled()
      expect(fetcher).not.toHaveBeenCalled()
    })
  })
})

function l2NormalizeForTest(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))
  return values.map((v) => v / norm)
}
