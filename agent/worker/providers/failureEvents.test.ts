import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordFallbackSuccess, recordProviderFailure } from './failureEvents'
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

  // ADR-0018 S1c: event_kind (20260824000000_provider_failure_events_
  // event_kind.sql) distinguishes an ordinary failure row from
  // recordFallbackSuccess's row -- recordProviderFailure never sets it,
  // relying on the column's own `default 'failure'` instead.
  it('never sends an event_kind key -- keeps the column\'s own default (ADR-0018 S1c)', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).not.toHaveProperty('event_kind')
      return new Response(null, { status: 201 })
    })
    vi.stubGlobal('fetch', fetcher)

    await recordProviderFailure(ENV, { capability: 'text_generation', provider_id: 'gemini', http_status: 429 })
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

// ADR-0018 S1c: FallbackTextGenerationProvider's own persisted marker that
// a secondary provider served a request after the primary failed.
describe('recordFallbackSuccess (ADR-0018 S1c)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('inserts provider_id as the REAL, unmangled id of the provider that served the request, event_kind: \'fallback_success\', no http_status, and no request_id when the caller has none', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://supa.test/rest/v1/provider_failure_events')
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({
        capability: 'text_generation',
        provider_id: 'workers-ai',
        http_status: null,
        request_id: null,
        event_kind: 'fallback_success',
      })
      return new Response(null, { status: 201 })
    })
    vi.stubGlobal('fetch', fetcher)

    await recordFallbackSuccess(ENV, { capability: 'text_generation', provider_id: 'workers-ai' })

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('preserves a REAL request_id when the caller has one -- never overwritten with a marker (request_id keeps only its original per-call meaning)', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({
        capability: 'text_generation',
        provider_id: 'workers-ai',
        http_status: null,
        request_id: 'req-42',
        event_kind: 'fallback_success',
      })
      return new Response(null, { status: 201 })
    })
    vi.stubGlobal('fetch', fetcher)

    await recordFallbackSuccess(ENV, { capability: 'text_generation', provider_id: 'workers-ai', request_id: 'req-42' })
  })

  it('swallows a persistence failure the same fail-safe way recordProviderFailure does', async () => {
    const fetcher = vi.fn(async () => new Response('table missing', { status: 404 }))
    vi.stubGlobal('fetch', fetcher)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      recordFallbackSuccess(ENV, { capability: 'text_generation', provider_id: 'gemini' }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  // Deploy-order guard: 20260824000000_provider_failure_events_event_kind.sql
  // is authored, NOT yet applied -- until it is, every real insert this
  // function makes hits exactly this Postgres error. Proves that specific,
  // currently-live gap is fail-safe, not just persistence failures in the
  // abstract (see that migration's own header comment for the required
  // deploy order).
  it('swallows a missing event_kind column error (migration not yet applied) the same fail-safe way', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ code: '42703', message: 'column "event_kind" of relation "provider_failure_events" does not exist' }),
      { status: 400 },
    ))
    vi.stubGlobal('fetch', fetcher)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      recordFallbackSuccess(ENV, { capability: 'text_generation', provider_id: 'workers-ai' }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })
})
