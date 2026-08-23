import { describe, expect, it, vi } from 'vitest'
import { ProviderRequestError, ProviderUnavailableError, fetchGeminiOrThrow } from './provider-errors'

describe('fetchGeminiOrThrow (INC-01)', () => {
  it('throws ProviderUnavailableError on a 429 response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'RESOURCE_EXHAUSTED' }), { status: 429 }))

    await expect(fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API'))
      .rejects.toBeInstanceOf(ProviderUnavailableError)
  })

  it.each([500, 502, 503, 504])('throws ProviderUnavailableError on a %s response', async (status) => {
    const fetcher = vi.fn(async () => new Response('server error', { status }))

    await expect(fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API'))
      .rejects.toBeInstanceOf(ProviderUnavailableError)
  })

  it('throws ProviderUnavailableError when the fetch call itself rejects (network failure)', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') })

    await expect(fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API'))
      .rejects.toBeInstanceOf(ProviderUnavailableError)
  })

  it('throws ProviderRequestError (still `instanceof Error`, but NOT ProviderUnavailableError) on a non-retryable 4xx -- a bug on our own side, not the provider being down', async () => {
    const fetcher = vi.fn(async () => new Response('bad request', { status: 400 }))

    const rejection = fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API')
    await expect(rejection).rejects.toThrow(Error)
    await expect(rejection).rejects.toBeInstanceOf(ProviderRequestError)
    await expect(rejection).rejects.not.toBeInstanceOf(ProviderUnavailableError)
  })

  it('resolves with the response on a 2xx', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const res = await fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API')
    expect(res.status).toBe(200)
  })

  // ADR-0018 S1: these two additive fields let a caller with its own
  // richer taxonomy (e.g. document-memory-extraction-endpoint.ts's
  // ProviderCallError, unified in this same slice) recover the exact HTTP
  // status/body without re-deriving it from the error message string --
  // see ProviderUnavailableError's own header comment for why.
  describe('status/body fields (ADR-0018 S1)', () => {
    it('ProviderUnavailableError carries the real HTTP status and body for a retryable status (429/5xx)', async () => {
      const fetcher = vi.fn(async () => new Response('rate limited', { status: 429 }))

      try {
        await fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API')
        expect.unreachable('expected fetchGeminiOrThrow to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderUnavailableError)
        expect((err as ProviderUnavailableError).status).toBe(429)
        expect((err as ProviderUnavailableError).body).toBe('rate limited')
      }
    })

    it('ProviderUnavailableError leaves status/body undefined for a genuine network-level failure -- there is no HTTP response to report', async () => {
      const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') })

      try {
        await fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API')
        expect.unreachable('expected fetchGeminiOrThrow to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderUnavailableError)
        expect((err as ProviderUnavailableError).status).toBeUndefined()
        expect((err as ProviderUnavailableError).body).toBeUndefined()
      }
    })

    it('ProviderRequestError carries the real HTTP status and body for a non-retryable 4xx', async () => {
      const fetcher = vi.fn(async () => new Response('bad request body', { status: 400 }))

      try {
        await fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API')
        expect.unreachable('expected fetchGeminiOrThrow to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderRequestError)
        expect((err as ProviderRequestError).status).toBe(400)
        expect((err as ProviderRequestError).body).toBe('bad request body')
      }
    })
  })

  // ADR-0018 S1 follow-up: a non-ok response body must never reach a
  // thrown error's `.body` field unbounded -- an upstream proxy or the
  // provider itself can return an arbitrarily large error page.
  describe('error body truncation (ADR-0018 S1 follow-up)', () => {
    it('leaves a short body untouched', async () => {
      const fetcher = vi.fn(async () => new Response('rate limited', { status: 429 }))

      try {
        await fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API')
        expect.unreachable('expected fetchGeminiOrThrow to throw')
      } catch (err) {
        expect((err as ProviderUnavailableError).body).toBe('rate limited')
      }
    })

    it('truncates a body over 4000 chars to 4000 chars plus a marker, for both ProviderUnavailableError and ProviderRequestError', async () => {
      const hugeBody = 'x'.repeat(10_000)

      const unavailableFetcher = vi.fn(async () => new Response(hugeBody, { status: 503 }))
      try {
        await fetchGeminiOrThrow(unavailableFetcher, 'https://example.test', {}, 'Test API')
        expect.unreachable('expected fetchGeminiOrThrow to throw')
      } catch (err) {
        const body = (err as ProviderUnavailableError).body as string
        expect(body.length).toBe(4000 + '...(truncated)'.length)
        expect(body.startsWith('x'.repeat(4000))).toBe(true)
        expect(body.endsWith('...(truncated)')).toBe(true)
      }

      const requestFetcher = vi.fn(async () => new Response(hugeBody, { status: 400 }))
      try {
        await fetchGeminiOrThrow(requestFetcher, 'https://example.test', {}, 'Test API')
        expect.unreachable('expected fetchGeminiOrThrow to throw')
      } catch (err) {
        const body = (err as ProviderRequestError).body
        expect(body.length).toBe(4000 + '...(truncated)'.length)
        expect(body.endsWith('...(truncated)')).toBe(true)
      }
    })
  })
})
