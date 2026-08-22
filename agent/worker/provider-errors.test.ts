import { describe, expect, it, vi } from 'vitest'
import { ProviderUnavailableError, fetchGeminiOrThrow } from './provider-errors'

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

  it('throws a plain Error (not ProviderUnavailableError) on a non-retryable 4xx -- a bug on our own side, not the provider being down', async () => {
    const fetcher = vi.fn(async () => new Response('bad request', { status: 400 }))

    const rejection = fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API')
    await expect(rejection).rejects.toThrow(Error)
    await expect(rejection).rejects.not.toBeInstanceOf(ProviderUnavailableError)
  })

  it('resolves with the response on a 2xx', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const res = await fetchGeminiOrThrow(fetcher, 'https://example.test', {}, 'Test API')
    expect(res.status).toBe(200)
  })
})
