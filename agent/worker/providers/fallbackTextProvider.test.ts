import { describe, expect, it, vi } from 'vitest'
import { FallbackTextGenerationProvider } from './fallbackTextProvider'
import { ProviderUnavailableError } from '../provider-errors'
import { FALLBACK_SUCCESS_MARKER } from './failureEvents'
import type { TextGenerationProvider, TextGenerationRequest, TextGenerationResult } from './types'

const ENV = { SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_KEY: 'service-key' }

const REQ: TextGenerationRequest = { turns: [{ role: 'user', content: 'hi' }] }

function stubProvider(id: string, impl: () => Promise<TextGenerationResult>): TextGenerationProvider {
  return { id, generateText: vi.fn(impl) }
}

describe('FallbackTextGenerationProvider (ADR-0018 S1c)', () => {
  it('primary ok -- returns the primary result directly, secondary never called, no event recorded', async () => {
    const primaryResult: TextGenerationResult = { text: 'from primary', finishReason: 'stop' }
    const primary = stubProvider('gemini', async () => primaryResult)
    const secondary = stubProvider('workers-ai', async () => ({ text: 'never', finishReason: 'stop' }))
    const fetcher = vi.fn()

    const wrapper = new FallbackTextGenerationProvider(primary, secondary, ENV, fetcher)
    const result = await wrapper.generateText(REQ)

    expect(result).toBe(primaryResult)
    expect(secondary.generateText).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('primary unavailable -- secondary serves the request and a fallback-success event is recorded with the SECONDARY\'s real, unmangled provider_id', async () => {
    const primary = stubProvider('gemini', async () => {
      throw new ProviderUnavailableError('gemini down', 503, 'body')
    })
    const secondaryResult: TextGenerationResult = { text: 'from secondary', finishReason: 'stop' }
    const secondary = stubProvider('workers-ai', async () => secondaryResult)
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toEqual({
        capability: 'text_generation',
        provider_id: 'workers-ai',
        http_status: null,
        request_id: FALLBACK_SUCCESS_MARKER,
      })
      return new Response(null, { status: 201 })
    })

    const wrapper = new FallbackTextGenerationProvider(primary, secondary, ENV, fetcher)
    const result = await wrapper.generateText(REQ)

    expect(result).toBe(secondaryResult)
    expect(secondary.generateText).toHaveBeenCalledWith(REQ)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://supa.test/rest/v1/provider_failure_events')
  })

  it('both fail -- the secondary\'s ProviderUnavailableError propagates unchanged (honest PROVIDER_UNAVAILABLE), no fallback-success event, no third attempt', async () => {
    const primary = stubProvider('gemini', async () => {
      throw new ProviderUnavailableError('gemini down', 503, 'body')
    })
    const secondaryError = new ProviderUnavailableError('workers-ai down too')
    const secondary = stubProvider('workers-ai', async () => {
      throw secondaryError
    })
    const fetcher = vi.fn(async () => new Response(null, { status: 201 }))

    const wrapper = new FallbackTextGenerationProvider(primary, secondary, ENV, fetcher)

    await expect(wrapper.generateText(REQ)).rejects.toBe(secondaryError)
    expect(primary.generateText).toHaveBeenCalledTimes(1)
    expect(secondary.generateText).toHaveBeenCalledTimes(1)
    // No fallback-success POST -- the only insert this wrapper itself makes
    // is on a SUCCESSFUL secondary call.
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('a non-ProviderUnavailableError from the primary propagates immediately -- the secondary is never tried', async () => {
    const primaryError = new Error('some other bug, not a provider outage')
    const primary = stubProvider('gemini', async () => {
      throw primaryError
    })
    const secondary = stubProvider('workers-ai', async () => ({ text: 'never', finishReason: 'stop' }))
    const fetcher = vi.fn()

    const wrapper = new FallbackTextGenerationProvider(primary, secondary, ENV, fetcher)

    await expect(wrapper.generateText(REQ)).rejects.toBe(primaryError)
    expect(secondary.generateText).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('a fallback-success persistence failure is swallowed -- the caller still gets the secondary\'s real result', async () => {
    const primary = stubProvider('gemini', async () => {
      throw new ProviderUnavailableError('gemini down')
    })
    const secondaryResult: TextGenerationResult = { text: 'from secondary', finishReason: 'stop' }
    const secondary = stubProvider('workers-ai', async () => secondaryResult)
    const fetcher = vi.fn(async () => new Response('table missing', { status: 404 }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const wrapper = new FallbackTextGenerationProvider(primary, secondary, ENV, fetcher)
    const result = await wrapper.generateText(REQ)

    expect(result).toBe(secondaryResult)
    warnSpy.mockRestore()
  })
})
