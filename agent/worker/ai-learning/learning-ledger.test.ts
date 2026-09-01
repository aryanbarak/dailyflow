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
    await appendAiLearningEvent(testEnv(), validInput({ idempotencyKey: 'idem-3', eventKind: 'user_feedback', producerType: 'user', labelConfidence: 'user_confirmed' }))

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

// ARCHITECTURAL REVIEW CORRECTION: a 23505 unique-conflict on the initial
// insert is never automatically "duplicate success" -- appendAiLearningEvent
// reads the conflicting row back by (user_id, idempotency_key) and
// compares its content against the request before deciding. These tests
// exercise the reconciliation path directly, per the review's own
// lettered test list (A-E).
describe('appendAiLearningEvent idempotency reconciliation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const UNIQUE_VIOLATION_BODY = JSON.stringify({
    code: '23505',
    message: 'duplicate key value violates unique constraint "ai_learning_events_user_idempotency_key_unique"',
  })

  function existingRowFor(input: AiLearningEventInput, overrides: Record<string, unknown> = {}) {
    return {
      id: 'existing-row-id',
      user_id: input.userId,
      session_id: input.sessionId ?? null,
      source_message_id: input.sourceMessageId ?? null,
      correlation_id: input.correlationId,
      idempotency_key: input.idempotencyKey,
      learning_task: input.learningTask,
      schema_version: input.schemaVersion,
      event_kind: input.eventKind,
      producer_type: input.producerType,
      provider_id: input.providerId ?? null,
      model_id: input.modelId ?? null,
      model_version: input.modelVersion ?? null,
      label_confidence: input.labelConfidence ?? null,
      source_hash: input.sourceHash ?? null,
      payload: input.payload,
      ...overrides,
    }
  }

  // Sequential fetch mock: first call is the POST (returns
  // postResponseInit), every subsequent call is the reconciliation GET
  // (returns the given rows as a 200 JSON array).
  function stubPostThenGet(postResponseInit: { status: number; body: string }, getRows: unknown[]) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let callIndex = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      callIndex += 1
      if (callIndex === 1) {
        return new Response(postResponseInit.body, { status: postResponseInit.status })
      }
      return new Response(JSON.stringify(getRows), { status: 200 })
    }))
    return calls
  }

  // A. same user + same key + same event -> duplicate success.
  it('A: same user + same idempotencyKey + identical content -> duplicate success', async () => {
    const input = validInput()
    const calls = stubPostThenGet({ status: 409, body: UNIQUE_VIOLATION_BODY }, [existingRowFor(input)])
    const logger = { error: vi.fn() }

    const result = await appendAiLearningEvent(testEnv(), input, { logger })

    expect(result).toEqual({ ok: true, duplicate: true })
    expect(logger.error).not.toHaveBeenCalled()
    // The reconciliation read is scoped by BOTH user_id and idempotency_key.
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('user_id=eq.user-1')
    expect(calls[1].url).toContain('idempotency_key=eq.idem-1')
  })

  // B. same user + same key + different payload -> IDEMPOTENCY_CONFLICT.
  it('B: same user + same idempotencyKey + different payload -> IDEMPOTENCY_CONFLICT, never overwritten', async () => {
    const input = validInput()
    const differentPayload = { ...input.payload, domain: 'tasks', interactionClass: 'write' as const, requiresApproval: true }
    stubPostThenGet({ status: 409, body: UNIQUE_VIOLATION_BODY }, [existingRowFor(input, { payload: differentPayload })])
    const logger = { error: vi.fn() }

    const result = await appendAiLearningEvent(testEnv(), input, { logger })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('IDEMPOTENCY_CONFLICT')
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  // C. same user + same key + different eventKind -> IDEMPOTENCY_CONFLICT.
  it('C: same user + same idempotencyKey + different eventKind -> IDEMPOTENCY_CONFLICT', async () => {
    const input = validInput({ eventKind: 'production_label', producerType: 'deterministic_policy', labelConfidence: 'validated' })
    stubPostThenGet({ status: 409, body: UNIQUE_VIOLATION_BODY }, [existingRowFor(input, { event_kind: 'turn_observed', label_confidence: null })])
    const logger = { error: vi.fn() }

    const result = await appendAiLearningEvent(testEnv(), input, { logger })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('IDEMPOTENCY_CONFLICT')
  })

  // D. two different users may use the same idempotencyKey independently
  // -- the reconciliation read is always scoped by (user_id,
  // idempotency_key) TOGETHER, so it can never surface a different
  // user's row as a false conflict for this user's identical key.
  it('D: two different users using the identical idempotencyKey never conflict with each other', async () => {
    const userA = validInput({ userId: 'user-a', idempotencyKey: 'shared-key' })
    const userB = validInput({ userId: 'user-b', idempotencyKey: 'shared-key' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })))
    const resultA = await appendAiLearningEvent(testEnv(), userA)
    const resultB = await appendAiLearningEvent(testEnv(), userB)
    expect(resultA).toEqual({ ok: true, duplicate: false })
    expect(resultB).toEqual({ ok: true, duplicate: false })
    vi.unstubAllGlobals()

    // Even in the conflict path, a lookup scoped to user-a's own id can
    // only ever match user-a's own row -- user-b's row (different
    // user_id, same idempotency_key) is never treated as user-a's
    // duplicate. Simulate: the POST for user-a conflicts, but the only
    // existing row the reconciliation GET could find belongs to user-b
    // (the query is scoped by user_id, so a correct implementation would
    // never actually receive this row for a user-a lookup -- but even if
    // it somehow did, content comparison must still fail on user_id).
    stubPostThenGet({ status: 409, body: UNIQUE_VIOLATION_BODY }, [existingRowFor(userB)])
    const logger = { error: vi.fn() }
    const conflictResult = await appendAiLearningEvent(testEnv(), userA, { logger })
    expect(conflictResult.ok).toBe(false)
    if (!conflictResult.ok) expect(conflictResult.error).toBe('IDEMPOTENCY_CONFLICT')
  })

  // E. a generic unrelated 23505 must not be blindly treated as duplicate
  // success -- if the reconciliation read finds NO matching
  // (user_id, idempotency_key) row at all, this was some other conflict
  // entirely, and must be reported as a failure, never as { ok: true }.
  it('E: a 23505 that does not resolve to a matching row is reported as a failure, never as duplicate success', async () => {
    const input = validInput()
    stubPostThenGet({ status: 409, body: UNIQUE_VIOLATION_BODY }, [])
    const logger = { error: vi.fn() }

    const result = await appendAiLearningEvent(testEnv(), input, { logger })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('PERSISTENCE_FAILED')
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('never overwrites the existing row -- no PATCH/PUT call happens during reconciliation, in any of the above scenarios', async () => {
    const input = validInput();
    const calls = stubPostThenGet({ status: 409, body: UNIQUE_VIOLATION_BODY }, [existingRowFor(input, { payload: { ...input.payload, domain: 'tasks' } })])

    await appendAiLearningEvent(testEnv(), input)

    for (const call of calls) {
      expect(call.init?.method).not.toBe('PATCH')
      expect(call.init?.method).not.toBe('PUT')
      expect(call.init?.method).not.toBe('DELETE')
    }
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
