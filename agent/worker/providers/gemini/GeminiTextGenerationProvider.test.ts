import { describe, expect, it, vi } from 'vitest'
import { ProviderRequestError, ProviderUnavailableError } from '../../provider-errors'
import { GeminiTextGenerationProvider } from './GeminiTextGenerationProvider'

// SUPABASE_URL/SUPABASE_SERVICE_KEY: needed only for the failure-event
// persistence path (ADR-0018 Decision 6, see the describe block below) --
// present on every test's env so GeminiProviderEnv is always satisfied;
// tests that don't trigger a ProviderUnavailableError never exercise them.
const ENV = { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-2.5-flash', SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_KEY: 'service-key' }

function geminiResponse(candidate: Record<string, unknown> | null, status = 200) {
  return new Response(
    JSON.stringify({ candidates: candidate ? [candidate] : [] }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('GeminiTextGenerationProvider', () => {
  it('has id "gemini"', () => {
    const provider = new GeminiTextGenerationProvider(ENV, vi.fn())
    expect(provider.id).toBe('gemini')
  })

  describe('request envelope shape', () => {
    it('sends system_instruction only when req.system is provided', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: 'hi' }] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await provider.generateText({ turns: [{ role: 'user', content: 'hello' }] })
      const bodyWithoutSystem = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(bodyWithoutSystem.system_instruction).toBeUndefined()

      await provider.generateText({ system: 'Be terse.', turns: [{ role: 'user', content: 'hello' }] })
      const bodyWithSystem = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
      expect(bodyWithSystem.system_instruction).toEqual({ parts: [{ text: 'Be terse.' }] })
    })

    it('maps role: assistant -> model, everything else -> user', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await provider.generateText({
        turns: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello there' },
          { role: 'user', content: 'follow up' },
        ],
      })

      const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello there' }] },
        { role: 'user', parts: [{ text: 'follow up' }] },
      ])
    })

    it('sends maxOutputTokens/temperature only when provided on the request', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      const bareBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(bareBody.generationConfig).toEqual({})

      await provider.generateText({ turns: [{ role: 'user', content: 'hi' }], maxOutputTokens: 512, temperature: 0.2 })
      const fullBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
      expect(fullBody.generationConfig).toEqual({ maxOutputTokens: 512, temperature: 0.2 })
    })

    it('includes generationConfig.thinkingConfig ONLY when providerOptions.thinkingConfig is present -- the adapter never defaults it', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      const withoutThinking = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(withoutThinking.generationConfig.thinkingConfig).toBeUndefined()

      await provider.generateText({
        turns: [{ role: 'user', content: 'hi' }],
        providerOptions: { thinkingConfig: { thinkingBudget: 0 } },
      })
      const withThinking = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
      expect(withThinking.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    })

    it('appends inlineDataAttachment as a part AFTER the text part, on the LAST turn only, and only when that turn is role: user', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await provider.generateText({
        turns: [
          { role: 'user', content: 'earlier turn' },
          { role: 'assistant', content: 'a reply' },
          { role: 'user', content: 'what is in this image?' },
        ],
        providerOptions: { inlineDataAttachment: { mimeType: 'image/png', data: 'base64data' } },
      })

      const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(body.contents[0].parts).toEqual([{ text: 'earlier turn' }])
      expect(body.contents[2].parts).toEqual([
        { text: 'what is in this image?' },
        { inlineData: { mimeType: 'image/png', data: 'base64data' } },
      ])
    })

    it('does NOT attach inlineDataAttachment when the last turn is role: assistant', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await provider.generateText({
        turns: [{ role: 'assistant', content: 'last turn is mine' }],
        providerOptions: { inlineDataAttachment: { mimeType: 'image/png', data: 'base64data' } },
      })

      const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(body.contents[0].parts).toEqual([{ text: 'last turn is mine' }])
    })

    it('builds the URL from GEMINI_MODEL/GEMINI_API_KEY (names only)', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }))
      const provider = new GeminiTextGenerationProvider({ GEMINI_API_KEY: 'my-key', GEMINI_MODEL: 'my-model', SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_KEY: 'service-key' }, fetcher)

      await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })

      const url = String(fetcher.mock.calls[0][0])
      expect(url).toContain('/models/my-model:generateContent')
      expect(url).toContain('key=my-key')
    })
  })

  describe('text extraction', () => {
    it('extracts candidates[0].content.parts[0].text', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: 'the answer' }] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      const result = await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      expect(result.text).toBe('the answer')
    })

    it('resolves to an empty string, never throws, when there is no candidate at all', async () => {
      const fetcher = vi.fn(async () => geminiResponse(null))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      const result = await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      expect(result.text).toBe('')
      expect(result.finishReason).toBe('other')
    })

    it('resolves to an empty string, never throws, when text itself is missing from the candidate', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      const result = await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      expect(result.text).toBe('')
    })
  })

  describe('finishReason mapping (neutral enum)', () => {
    it.each([
      ['STOP', 'stop'],
      ['MAX_TOKENS', 'length'],
      ['SAFETY', 'other'],
      ['RECITATION', 'other'],
      ['OTHER', 'other'],
      [undefined, 'other'],
    ])('%s -> %s', async (raw, expected) => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: raw, content: { parts: [{ text: 'x' }] } }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      const result = await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      expect(result.finishReason).toBe(expected)
    })
  })

  describe('failure classification (via provider-errors.ts)', () => {
    it('429 -> ProviderUnavailableError', async () => {
      const fetcher = vi.fn(async () => new Response('rate limited', { status: 429 }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it.each([500, 502, 503, 504])('%s -> ProviderUnavailableError', async (status) => {
      const fetcher = vi.fn(async () => new Response('server error', { status }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it('a network-level failure (fetch rejects) -> ProviderUnavailableError', async () => {
      const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') })
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it('400 -> ProviderRequestError (not ProviderUnavailableError) -- a bug on our own side, not the provider being down', async () => {
      const fetcher = vi.fn(async () => new Response('bad request', { status: 400 }))
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      const rejection = provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      await expect(rejection).rejects.toBeInstanceOf(ProviderRequestError)
      await expect(rejection).rejects.not.toBeInstanceOf(ProviderUnavailableError)
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

    it('records a failure event (capability text_generation, the real HTTP status) when the Gemini call throws ProviderUnavailableError', async () => {
      const { fetcher, supabaseInsert } = urlAwareFetcher(429)
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)

      expect(supabaseInsert).toHaveBeenCalledTimes(1)
      const [, init] = supabaseInsert.mock.calls[0]
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ capability: 'text_generation', provider_id: 'gemini', http_status: 429 })
    })

    it('records http_status: null for a network-level failure (no HTTP response was ever received)', async () => {
      const supabaseInsert = vi.fn(async () => new Response(null, { status: 201 }))
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/rest/v1/provider_failure_events')) return supabaseInsert(input, init)
        throw new TypeError('fetch failed')
      })
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)

      const [, init] = supabaseInsert.mock.calls[0]
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ http_status: null })
    })

    it('does NOT record a failure event for a ProviderRequestError (400) -- only ProviderUnavailableError is a provider-availability failure', async () => {
      const { fetcher, supabaseInsert } = urlAwareFetcher(400, 'bad request')
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderRequestError)

      expect(supabaseInsert).not.toHaveBeenCalled()
    })

    it('a failed persistence attempt (fail-safe) never changes the outcome -- the original ProviderUnavailableError still propagates', async () => {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/rest/v1/provider_failure_events')) return new Response('table missing', { status: 404 })
        return new Response('rate limited', { status: 429 })
      })
      const provider = new GeminiTextGenerationProvider(ENV, fetcher)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })
  })
})
