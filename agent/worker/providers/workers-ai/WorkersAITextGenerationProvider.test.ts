import { describe, expect, it, vi } from 'vitest'
import { ProviderUnavailableError } from '../../provider-errors'
import {
  AttachmentsUnsupportedError,
  DEFAULT_WORKERS_AI_TEXT_MODEL,
  WorkersAITextGenerationProvider,
  type WorkersAIBinding,
} from './WorkersAITextGenerationProvider'

// SUPABASE_URL/SUPABASE_SERVICE_KEY: needed only for the failure-event
// persistence path (ADR-0018 Decision 6) -- same precedent as
// GeminiTextGenerationProvider.test.ts's own ENV constant.
function makeEnv(run: WorkersAIBinding['run']) {
  return {
    AI: { run } as WorkersAIBinding,
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_KEY: 'service-key',
  }
}

// No default for finishReason -- a JS default parameter substitutes on an
// explicitly-passed `undefined` too, which would silently mask the
// [undefined, 'other'] case in the finishReason mapping table below.
function chatCompletion(content: string | null, finishReason?: string) {
  return { choices: [{ message: { content }, finish_reason: finishReason }] }
}

describe('WorkersAITextGenerationProvider', () => {
  it('has id "workers-ai"', () => {
    const provider = new WorkersAITextGenerationProvider(makeEnv(vi.fn()))
    expect(provider.id).toBe('workers-ai')
  })

  describe('request mapping', () => {
    it('sends no system message when req.system is absent, a leading system message when present', async () => {
      const run = vi.fn(async () => chatCompletion('hi'))
      const provider = new WorkersAITextGenerationProvider(makeEnv(run))

      await provider.generateText({ turns: [{ role: 'user', content: 'hello' }] })
      const [, inputsWithoutSystem] = run.mock.calls[0]
      expect((inputsWithoutSystem as { messages: unknown[] }).messages).toEqual([{ role: 'user', content: 'hello' }])

      await provider.generateText({ system: 'Be terse.', turns: [{ role: 'user', content: 'hello' }] })
      const [, inputsWithSystem] = run.mock.calls[1]
      expect((inputsWithSystem as { messages: unknown[] }).messages).toEqual([
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'hello' },
      ])
    })

    it('maps role: assistant -> assistant, everything else -> user', async () => {
      const run = vi.fn(async () => chatCompletion('ok'))
      const provider = new WorkersAITextGenerationProvider(makeEnv(run))

      await provider.generateText({
        turns: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello there' },
          { role: 'user', content: 'follow up' },
        ],
      })

      const [, inputs] = run.mock.calls[0]
      expect((inputs as { messages: unknown[] }).messages).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello there' },
        { role: 'user', content: 'follow up' },
      ])
    })

    it('sends max_tokens/temperature only when provided on the request', async () => {
      const run = vi.fn(async () => chatCompletion('ok'))
      const provider = new WorkersAITextGenerationProvider(makeEnv(run))

      await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      const [, bareInputs] = run.mock.calls[0]
      expect(bareInputs).not.toHaveProperty('max_tokens')
      expect(bareInputs).not.toHaveProperty('temperature')

      await provider.generateText({ turns: [{ role: 'user', content: 'hi' }], maxOutputTokens: 512, temperature: 0.2 })
      const [, fullInputs] = run.mock.calls[1]
      expect(fullInputs).toMatchObject({ max_tokens: 512, temperature: 0.2 })
    })

    it('calls env.AI.run with DEFAULT_WORKERS_AI_TEXT_MODEL', async () => {
      const run = vi.fn(async () => chatCompletion('ok'))
      const provider = new WorkersAITextGenerationProvider(makeEnv(run))

      await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      const [model] = run.mock.calls[0]
      expect(model).toBe(DEFAULT_WORKERS_AI_TEXT_MODEL)
    })
  })

  describe('text extraction', () => {
    it('returns choices[0].message.content, empty string when content is missing/null', async () => {
      const provider = new WorkersAITextGenerationProvider(makeEnv(vi.fn(async () => chatCompletion('hello world'))))
      const result = await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      expect(result.text).toBe('hello world')

      const nullContentProvider = new WorkersAITextGenerationProvider(makeEnv(vi.fn(async () => chatCompletion(null))))
      const nullResult = await nullContentProvider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      expect(nullResult.text).toBe('')

      const emptyProvider = new WorkersAITextGenerationProvider(makeEnv(vi.fn(async () => ({}))))
      const emptyResult = await emptyProvider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      expect(emptyResult.text).toBe('')
    })
  })

  describe('finishReason mapping (neutral enum)', () => {
    it.each([
      ['stop', 'stop'],
      ['length', 'length'],
      ['tool_calls', 'other'],
      ['content_filter', 'other'],
      ['function_call', 'other'],
      [undefined, 'other'],
    ])('%s -> %s', async (raw, expected) => {
      const provider = new WorkersAITextGenerationProvider(makeEnv(vi.fn(async () => chatCompletion('x', raw as string))))
      const result = await provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      expect(result.finishReason).toBe(expected)
    })
  })

  // Work item 2 (S1b task): this model is text-only -- an attachment must
  // be rejected loudly and typed, never silently dropped.
  describe('attachments rejection (ATTACHMENTS_UNSUPPORTED)', () => {
    it('throws AttachmentsUnsupportedError when providerOptions.inlineDataAttachment is present, without calling env.AI.run', async () => {
      const run = vi.fn(async () => chatCompletion('should never be reached'))
      const provider = new WorkersAITextGenerationProvider(makeEnv(run))

      const rejection = provider.generateText({
        turns: [{ role: 'user', content: 'describe this' }],
        attachmentPosition: 'after',
        providerOptions: { inlineDataAttachment: { mimeType: 'image/png', data: 'base64data' } },
      })

      await expect(rejection).rejects.toBeInstanceOf(AttachmentsUnsupportedError)
      await expect(rejection).rejects.toMatchObject({ code: 'ATTACHMENTS_UNSUPPORTED' })
      expect(run).not.toHaveBeenCalled()
    })

    it('does not reject a request with providerOptions but no inlineDataAttachment key', async () => {
      const run = vi.fn(async () => chatCompletion('ok'))
      const provider = new WorkersAITextGenerationProvider(makeEnv(run))

      const result = await provider.generateText({
        turns: [{ role: 'user', content: 'hi' }],
        providerOptions: { someOtherKey: 'value' },
      })
      expect(result.text).toBe('ok')
      expect(run).toHaveBeenCalledTimes(1)
    })
  })

  describe('failure classification (binding errors -> ProviderUnavailableError)', () => {
    it('env.AI.run throwing -> ProviderUnavailableError, message includes the model and the original error', async () => {
      const run = vi.fn(async () => { throw new Error('binding unavailable') })
      const provider = new WorkersAITextGenerationProvider(makeEnv(run))

      const rejection = provider.generateText({ turns: [{ role: 'user', content: 'hi' }] })
      await expect(rejection).rejects.toBeInstanceOf(ProviderUnavailableError)
      await expect(rejection).rejects.toMatchObject({
        message: expect.stringContaining(DEFAULT_WORKERS_AI_TEXT_MODEL) as unknown as string,
      })
      await expect(rejection).rejects.toMatchObject({
        message: expect.stringContaining('binding unavailable') as unknown as string,
      })
    })
  })

  // ADR-0018 Decision 6 (INC-01 follow-up): every ProviderUnavailableError
  // must be persisted via failureEvents.ts's recordProviderFailure, same
  // fail-safe discipline as GeminiTextGenerationProvider.
  describe('failure-event persistence (ADR-0018 Decision 6)', () => {
    it('records a failure event (capability text_generation, provider_id workers-ai, http_status null -- no HTTP status exists for a binding error)', async () => {
      const run = vi.fn(async () => { throw new Error('binding unavailable') })
      const supabaseInsert = vi.fn(async () => new Response(null, { status: 201 }))
      const env = makeEnv(run)
      const provider = new WorkersAITextGenerationProvider(env, supabaseInsert)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)

      expect(supabaseInsert).toHaveBeenCalledTimes(1)
      const [, init] = supabaseInsert.mock.calls[0]
      const body = JSON.parse(String((init as RequestInit)?.body))
      expect(body).toMatchObject({ capability: 'text_generation', provider_id: 'workers-ai', http_status: null })
    })

    it('a failed persistence attempt (fail-safe) never changes the outcome -- the original ProviderUnavailableError still propagates', async () => {
      const run = vi.fn(async () => { throw new Error('binding unavailable') })
      const failingFetcher = vi.fn(async () => new Response('table missing', { status: 404 }))
      const provider = new WorkersAITextGenerationProvider(makeEnv(run), failingFetcher)

      await expect(provider.generateText({ turns: [{ role: 'user', content: 'hi' }] }))
        .rejects.toBeInstanceOf(ProviderUnavailableError)
    })

    it('does NOT record a failure event for the attachments-unsupported rejection -- that is a caller bug, not a provider-availability failure', async () => {
      const run = vi.fn(async () => chatCompletion('unreached'))
      const supabaseInsert = vi.fn(async () => new Response(null, { status: 201 }))
      const provider = new WorkersAITextGenerationProvider(makeEnv(run), supabaseInsert)

      await expect(provider.generateText({
        turns: [{ role: 'user', content: 'hi' }],
        attachmentPosition: 'after',
        providerOptions: { inlineDataAttachment: { mimeType: 'image/png', data: 'x' } },
      })).rejects.toBeInstanceOf(AttachmentsUnsupportedError)

      expect(supabaseInsert).not.toHaveBeenCalled()
    })
  })
})
