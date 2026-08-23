import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordProviderFailure } from './failureEvents'
import type { Env } from '../types'

const ENV: Env = {
  SUPABASE_URL: 'https://supa.test',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_KEY: 'service-key',
  GEMINI_API_KEY: 'gemini-key',
  GEMINI_MODEL: 'gemini-2.5-flash',
  AI: {} as unknown as Env['AI'],
}

describe('recordProviderFailure (ADR-0018 Decision 6, fail-safe persistence)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('inserts the four failure-metadata fields into provider_failure_events via service-role auth', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://supa.test/rest/v1/provider_failure_events')
      expect(init?.headers).toMatchObject({ apikey: 'service-key', Authorization: 'Bearer service-key' })
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({
        capability: 'text_generation',
        provider_id: 'gemini',
        http_status: 429,
        request_id: 'req-1',
      })
      return new Response(null, { status: 201 })
    })
    vi.stubGlobal('fetch', fetcher)

    await recordProviderFailure(ENV, { capability: 'text_generation', provider_id: 'gemini', http_status: 429, request_id: 'req-1' })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('sends null for omitted optional fields (http_status/request_id), never undefined -- a real network failure has no HTTP status at all', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({ capability: 'text_generation', provider_id: 'gemini', http_status: null, request_id: null })
      return new Response(null, { status: 201 })
    })
    vi.stubGlobal('fetch', fetcher)

    await recordProviderFailure(ENV, { capability: 'text_generation', provider_id: 'gemini' })
  })

  // The core fail-safe guarantee this module exists for: the CALLER's own
  // request must complete regardless of what happens to the persistence
  // attempt.
  it('swallows a thrown insert failure (table missing / RLS denial / any Supabase REST error) -- the caller\'s own await still resolves', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ message: 'relation "provider_failure_events" does not exist' }), { status: 404 }))
    vi.stubGlobal('fetch', fetcher)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      recordProviderFailure(ENV, { capability: 'text_generation', provider_id: 'gemini', http_status: 429 }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('swallows a network-level failure (fetch itself rejects) the same way', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') })
    vi.stubGlobal('fetch', fetcher)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      recordProviderFailure(ENV, { capability: 'text_generation', provider_id: 'gemini' }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('never logs prompt/response content -- only the swallowed error\'s own message', async () => {
    const fetcher = vi.fn(async () => new Response('server error', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await recordProviderFailure(ENV, { capability: 'text_generation', provider_id: 'gemini', http_status: 500 })

    const loggedText = warnSpy.mock.calls.flat().join(' ')
    expect(loggedText).not.toContain('SUPABASE_SERVICE_KEY')
    expect(loggedText).not.toContain('service-key')
    warnSpy.mockRestore()
  })
})
