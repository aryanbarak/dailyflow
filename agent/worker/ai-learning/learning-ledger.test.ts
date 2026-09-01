import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendAiLearningEvent, computeSourceHash } from './learning-ledger'
import type { Env } from '../types'
import type { AiLearningEventInput } from '../../../shared/aiLearning'

const SUPABASE_URL = 'https://supa.test'

function testEnv(): Env {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_KEY: 'service-key',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
    AI: {} as unknown as Env['AI'],
  }
}

function validInput(overrides: Partial<AiLearningEventInput> = {}): AiLearningEventInput {
  return {
    userId: 'user-1',
    sessionId: null,
    sourceMessageId: null,
    correlationId: 'corr-1',
    idempotencyKey: 'idem-1',
    learningTask: 'intent_routing_v1',
    schemaVersion: 'intent-routing-v1',
    eventKind: 'turn_observed',
    producerType: 'deterministic_policy',
    providerId: null,
    modelId: null,
    modelVersion: null,
    labelConfidence: null,
    sourceHash: null,
    payload: {
      schemaVersion: 'intent-routing-v1',
      language: 'en',
      interactionClass: 'conversation',
      domain: 'none',
      requiresClarification: false,
      requiresApproval: false,
    },
    ...overrides,
  }
}

describe('appendAiLearningEvent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the full row to ai_learning_events via the service role', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(null, { status: 201 })
    }))

    const result = await appendAiLearningEvent(testEnv(), validInput())

    expect(result).toEqual({ ok: true, duplicate: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/ai_learning_events`)
    expect(calls[0].init?.method).toBe('POST')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.apikey).toBe('service-key')
    expect(headers.Authorization).toBe('Bearer service-key')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body).toEqual({
      user_id: 'user-1',
      session_id: null,
      source_message_id: null,
      correlation_id: 'corr-1',
      idempotency_key: 'idem-1',
      learning_task: 'intent_routing_v1',
      schema_version: 'intent-routing-v1',
      event_kind: 'turn_observed',
      producer_type: 'deterministic_policy',
      provider_id: null,
      model_id: null,
      model_version: null,
      label_confidence: null,
      source_hash: null,
      payload: validInput().payload,
    })
  })

  // append-only: the ONLY HTTP method this module ever issues is POST --
  // a later fact about the same turn is always a new row (see the
  // module's own header comment), never a PATCH/PUT/DELETE against an
  // existing one.
  it('never issues any HTTP method other than POST', async () => {
    const methods: Array<string | undefined> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method)
      return new Response(null, { status: 201 })
    }))

    await appendAiLearningEvent(testEnv(), validInput({ idempotencyKey: 'idem-2' }))
    await appendAiLearningEvent(testEnv(), validInput({ idempotencyKey: 'idem-3', eventKind: 'user_feedback', producerType: 'user' }))

    expect(methods).toEqual(['POST', 'POST'])
  })

  it('the module source never imports a PATCH/PUT/DELETE write helper', () => {
    const source = readFileSync(join(__dirname, 'learning-ledger.ts'), 'utf8')
    const importLines = source.split('\n').filter((line) => line.trim().startsWith('import ') || line.trim().startsWith('} from'))
    const importText = importLines.join('\n')
    expect(importText).not.toContain('supabasePatch')
    expect(importText).not.toContain('supabaseWriteReturning')
    expect(source).not.toMatch(/method:\s*'PATCH'/)
    expect(source).not.toMatch(/method:\s*'DELETE'/)
  })

  it('refuses to append an invalid event without making any network call', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const logger = { error: vi.fn() }

    const result = await appendAiLearningEvent(testEnv(), validInput({ eventKind: 'bogus_kind' as never }), { logger })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('INVALID_INPUT')
      expect(result.details.length).toBeGreaterThan(0)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('treats a duplicate idempotency_key (Postgres 23505) as an idempotent success, not a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint "ai_learning_events_idempotency_key_key"' }),
      { status: 409 },
    )))
    const logger = { error: vi.fn() }

    const result = await appendAiLearningEvent(testEnv(), validInput(), { logger })

    expect(result).toEqual({ ok: true, duplicate: true })
    // A duplicate append landing successfully is not an error worth
    // logging -- see the module's own header comment.
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('never throws on a genuine persistence failure -- reports { ok: false } instead (learning failure != production failure)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('internal error', { status: 500 })))
    const logger = { error: vi.fn() }

    const result = await appendAiLearningEvent(testEnv(), validInput(), { logger })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('PERSISTENCE_FAILED')
    }
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('never throws when the underlying fetch rejects outright', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network exploded')
    }))
    const logger = { error: vi.fn() }

    await expect(appendAiLearningEvent(testEnv(), validInput(), { logger })).resolves.toMatchObject({ ok: false })
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('never claims success when persistence actually failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })))

    const result = await appendAiLearningEvent(testEnv(), validInput())

    expect(result.ok).toBe(false)
  })
})

describe('computeSourceHash', () => {
  it('is deterministic for the same input text', async () => {
    const a = await computeSourceHash('برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم')
    const b = await computeSourceHash('برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم')
    expect(a).toBe(b)
  })

  it('produces different hashes for different input text', async () => {
    const a = await computeSourceHash('text one')
    const b = await computeSourceHash('text two')
    expect(a).not.toBe(b)
  })

  it('returns a lowercase hex sha-256 digest (64 chars)', async () => {
    const hash = await computeSourceHash('hello')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
