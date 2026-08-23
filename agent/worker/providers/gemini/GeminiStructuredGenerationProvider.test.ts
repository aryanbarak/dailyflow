import { describe, expect, it, vi } from 'vitest'
import { ProviderRequestError, ProviderUnavailableError } from '../../provider-errors'
import { GeminiStructuredGenerationProvider } from './GeminiStructuredGenerationProvider'
import type { NeutralObjectSchema } from '../schema/neutralSchema'

// Mirrors GeminiTextGenerationProvider.test.ts's own ENV fixture and
// rationale -- SUPABASE_URL/SUPABASE_SERVICE_KEY are needed only for the
// failure-event persistence path (ADR-0018 Decision 6).
const ENV = { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-2.5-flash', SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_KEY: 'service-key' }

const SIMPLE_SCHEMA: NeutralObjectSchema = {
  type: 'object',
  required: ['title'],
  properties: { title: { type: 'string' } },
}

function geminiResponse(candidate: Record<string, unknown> | null, status = 200) {
  return new Response(
    JSON.stringify({ candidates: candidate ? [candidate] : [] }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('GeminiStructuredGenerationProvider', () => {
  it('has id "gemini"', () => {
    const provider = new GeminiStructuredGenerationProvider(ENV, vi.fn())
    expect(provider.id).toBe('gemini')
  })

  describe('request envelope shape', () => {
    it('always sends responseMimeType:application/json and the translated schema, even with no other options', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: '{"title":"x"}' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })

      const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(body.generationConfig.responseMimeType).toBe('application/json')
      expect(body.generationConfig.responseSchema).toEqual({ type: 'OBJECT', required: ['title'], properties: { title: { type: 'STRING' } } })
    })

    it('sends system_instruction only when req.system is provided', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await provider.generateStructured({ turns: [{ role: 'user', content: 'hello' }], schema: SIMPLE_SCHEMA })
      const bodyWithoutSystem = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(bodyWithoutSystem.system_instruction).toBeUndefined()

      await provider.generateStructured({ system: 'Be terse.', turns: [{ role: 'user', content: 'hello' }], schema: SIMPLE_SCHEMA })
      const bodyWithSystem = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
      expect(bodyWithSystem.system_instruction).toEqual({ parts: [{ text: 'Be terse.' }] })
    })

    it('maps role: assistant -> model, everything else -> user', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await provider.generateStructured({
        turns: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello there' },
          { role: 'user', content: 'follow up' },
        ],
        schema: SIMPLE_SCHEMA,
      })

      const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello there' }] },
        { role: 'user', parts: [{ text: 'follow up' }] },
      ])
    })

    it('sends maxOutputTokens/temperature only when provided on the request', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      const bareBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(bareBody.generationConfig.maxOutputTokens).toBeUndefined()
      expect(bareBody.generationConfig.temperature).toBeUndefined()

      await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA, maxOutputTokens: 2048, temperature: 0 })
      const fullBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
      expect(fullBody.generationConfig.maxOutputTokens).toBe(2048)
      expect(fullBody.generationConfig.temperature).toBe(0)
    })

    it('includes generationConfig.thinkingConfig ONLY when providerOptions.thinkingConfig is present -- the adapter never defaults it', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      const withoutThinking = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
      expect(withoutThinking.generationConfig.thinkingConfig).toBeUndefined()

      await provider.generateStructured({
        turns: [{ role: 'user', content: 'hi' }],
        schema: SIMPLE_SCHEMA,
        providerOptions: { thinkingConfig: { thinkingBudget: 0 } },
      })
      const withThinking = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
      expect(withThinking.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    })

    it('builds the URL from GEMINI_MODEL/GEMINI_API_KEY (names only)', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }))
      const provider = new GeminiStructuredGenerationProvider({ GEMINI_API_KEY: 'my-key', GEMINI_MODEL: 'my-model', SUPABASE_URL: 'https://supa.test', SUPABASE_SERVICE_KEY: 'service-key' }, fetcher)

      await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })

      const url = String(fetcher.mock.calls[0][0])
      expect(url).toContain('/models/my-model:generateContent')
      expect(url).toContain('key=my-key')
    })
  })

  describe('raw text extraction (no parsing -- ADR-0018 Decision 1)', () => {
    it('extracts candidates[0].content.parts[0].text as rawText, unparsed', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: '{"title":"the answer"}' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const result = await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      expect(result.rawText).toBe('{"title":"the answer"}')
    })

    it('resolves to an empty rawText, never throws, when there is no candidate at all -- finishReason is "stop" (an absent finishReason maps to stop, see mapFinishReason\'s own comment), the empty text is what a caller should key off of', async () => {
      const fetcher = vi.fn(async () => geminiResponse(null))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const result = await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      expect(result.rawText).toBe('')
      expect(result.finishReason).toBe('stop')
    })

    it('resolves to an empty rawText, never throws, when text itself is missing from the candidate', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const result = await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      expect(result.rawText).toBe('')
    })
  })

  describe('usage extraction (ADR-0018 S2 amendment, 2026-08-23)', () => {
    it('extracts promptTokens/responseTokens from usageMetadata when present', async () => {
      const fetcher = vi.fn(async () => new Response(
        JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
          usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7 },
        }),
        { status: 200 },
      ))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const result = await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      expect(result.usage).toEqual({ promptTokens: 42, responseTokens: 7 })
    })

    it('omits usage entirely when usageMetadata is absent from the response', async () => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const result = await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      expect(result.usage).toBeUndefined()
    })
  })

  describe('rawFinishReason (ADR-0018 S2 amendment, 2026-08-23)', () => {
    it.each(['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER'])('carries the untranslated provider value %s alongside the neutral finishReason', async (raw) => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: raw, content: { parts: [{ text: 'x' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const result = await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      expect(result.rawFinishReason).toBe(raw)
    })

    it('is omitted when there is no candidate at all', async () => {
      const fetcher = vi.fn(async () => geminiResponse(null))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const result = await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      expect(result.rawFinishReason).toBeUndefined()
    })
  })

  describe('finishReason mapping (neutral enum)', () => {
    it.each([
      ['STOP', 'stop'],
      ['MAX_TOKENS', 'length'],
      ['SAFETY', 'other'],
      ['RECITATION', 'other'],
      ['OTHER', 'other'],
      // NOT 'other' -- see mapFinishReason's own comment: unlike the text
      // adapter, an ABSENT finishReason here maps to 'stop', matching all
      // four pre-S2 structured builders' own `!== undefined && !== 'STOP'`
      // check.
      [undefined, 'stop'],
    ])('%s -> %s', async (raw, expected) => {
      const fetcher = vi.fn(async () => geminiResponse({ finishReason: raw, content: { parts: [{ text: 'x' }] } }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const result = await provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      expect(result.finishReason).toBe(expected)
    })
  })

  describe('failure classification (via provider-errors.ts)', () => {
    it('429 -> ProviderUnavailableError', async () => {
      const fetcher = vi.fn(async () => new Response('rate limited', { status: 429 }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await expect(provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it.each([500, 502, 503, 504])('%s -> ProviderUnavailableError', async (status) => {
      const fetcher = vi.fn(async () => new Response('server error', { status }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await expect(provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it('a network-level failure (fetch rejects) -> ProviderUnavailableError', async () => {
      const fetcher = vi.fn(async () => { throw new TypeError('fetch failed') })
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await expect(provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it('400 -> ProviderRequestError (not ProviderUnavailableError) -- a bug on our own side, not the provider being down', async () => {
      const fetcher = vi.fn(async () => new Response('bad request', { status: 400 }))
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      const rejection = provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA })
      await expect(rejection).rejects.toBeInstanceOf(ProviderRequestError)
      await expect(rejection).rejects.not.toBeInstanceOf(ProviderUnavailableError)
    })
  })

  // ADR-0018 Decision 6: every ProviderUnavailableError must be persisted
  // via failureEvents.ts's recordProviderFailure, capability='structured_generation'.
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

    it('records a failure event (capability structured_generation, the real HTTP status) when the Gemini call throws ProviderUnavailableError', async () => {
      const { fetcher, supabaseInsert } = urlAwareFetcher(429)
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await expect(provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)

      expect(supabaseInsert).toHaveBeenCalledTimes(1)
      const [, init] = supabaseInsert.mock.calls[0]
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ capability: 'structured_generation', provider_id: 'gemini', http_status: 429 })
    })

    it('records http_status: null for a network-level failure (no HTTP response was ever received)', async () => {
      const supabaseInsert = vi.fn(async () => new Response(null, { status: 201 }))
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/rest/v1/provider_failure_events')) return supabaseInsert(input, init)
        throw new TypeError('fetch failed')
      })
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await expect(provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)

      const [, init] = supabaseInsert.mock.calls[0]
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ http_status: null })
    })

    it('does NOT record a failure event for a ProviderRequestError (400) -- only ProviderUnavailableError is a provider-availability failure', async () => {
      const { fetcher, supabaseInsert } = urlAwareFetcher(400, 'bad request')
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await expect(provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA }))
        .rejects.toBeInstanceOf(ProviderRequestError)

      expect(supabaseInsert).not.toHaveBeenCalled()
    })

    it('a failed persistence attempt (fail-safe) never changes the outcome -- the original ProviderUnavailableError still propagates', async () => {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/rest/v1/provider_failure_events')) return new Response('table missing', { status: 404 })
        return new Response('rate limited', { status: 429 })
      })
      const provider = new GeminiStructuredGenerationProvider(ENV, fetcher)

      await expect(provider.generateStructured({ turns: [{ role: 'user', content: 'hi' }], schema: SIMPLE_SCHEMA }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })
  })
})
