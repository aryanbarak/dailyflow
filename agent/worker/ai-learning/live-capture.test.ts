import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureProductionRoutingTurn } from './live-capture'
import { computeSourceHash } from './learning-ledger'
import type { LiveCaptureConfig } from './live-capture-config'
import type { Env } from '../types'

const SUPABASE_URL = 'https://supa.test'
const RAW_MESSAGE = 'برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم -- SECRET_MARKER_DO_NOT_LEAK'

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_KEY: 'service-key',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
    AI: {} as unknown as Env['AI'],
    ...overrides,
  }
}

function disabledConfig(): LiveCaptureConfig {
  return { captureEnabled: false, shadow: null }
}

function captureOnlyConfig(): LiveCaptureConfig {
  return { captureEnabled: true, shadow: null }
}

function shadowConfig(overrides: Partial<LiveCaptureConfig['shadow']> = {}): LiveCaptureConfig {
  return {
    captureEnabled: true,
    shadow: {
      providerId: 'workers-ai',
      modelId: '@cf/some-org/shadow-model',
      modelVersion: '2026-09-01',
      sampleRate: 1,
      ...overrides,
    },
  }
}

const VALID_LABEL_INPUT = {
  language: 'fa' as const,
  interactionClass: 'write' as const,
  domain: 'calendar' as const,
  intentType: 'create_calendar_event',
  toolId: 'calendar.create_event',
  requiresClarification: false,
  requiresApproval: true,
}

const VALID_SHADOW_PAYLOAD = {
  schemaVersion: 'intent-routing-v1',
  language: 'fa',
  interactionClass: 'write',
  domain: 'calendar',
  intentType: 'create_calendar_event',
  toolId: 'calendar.create_event',
  requiresClarification: false,
  requiresApproval: true,
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    env: testEnv(),
    config: captureOnlyConfig(),
    userId: 'user-1',
    sessionId: 'session-1',
    sourceMessageId: 'msg-abc-123',
    rawMessage: RAW_MESSAGE,
    label: VALID_LABEL_INPUT,
    ...overrides,
  }
}

function stubLogger() {
  return { log: vi.fn(), error: vi.fn() }
}

describe('captureProductionRoutingTurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // A. capture disabled -> zero learning writes, zero shadow calls.
  it('A: capture disabled makes zero network calls at all', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const aiRunSpy = vi.fn()

    await captureProductionRoutingTurn(baseParams({
      config: disabledConfig(),
      env: testEnv({ AI: { run: aiRunSpy } as unknown as Env['AI'] }),
    }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(aiRunSpy).not.toHaveBeenCalled()
  })

  // B. capture enabled, shadow disabled -> production_label append only.
  it('B: capture enabled + shadow disabled appends only a production_label event, never calls env.AI', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(null, { status: 201 })
    }))
    const aiRunSpy = vi.fn()

    await captureProductionRoutingTurn(baseParams({
      config: captureOnlyConfig(),
      env: testEnv({ AI: { run: aiRunSpy } as unknown as Env['AI'] }),
    }))

    expect(aiRunSpy).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${SUPABASE_URL}/rest/v1/ai_learning_events`)
    const body = calls[0].body as Record<string, unknown>
    expect(body.event_kind).toBe('production_label')
    expect(body.producer_type).toBe('deterministic_policy')
    expect(body.label_confidence).toBe('validated')
  })

  // C. shadow enabled + rate 1 + valid model result -> production_label +
  // shadow_prediction candidate + correct provider/model/version provenance.
  it('C: shadow enabled with rate 1 and a valid model result appends both events with correct provenance', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {} })
      return new Response(null, { status: 201 })
    }))
    const aiRun = vi.fn(async (_model: string, _inputs: Record<string, unknown>) => ({ choices: [{ message: { content: JSON.stringify(VALID_SHADOW_PAYLOAD) } }] }))

    await captureProductionRoutingTurn(baseParams({
      config: shadowConfig(),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }))

    expect(aiRun).toHaveBeenCalledTimes(1)
    expect(aiRun.mock.calls[0][0]).toBe('@cf/some-org/shadow-model')
    expect(calls).toHaveLength(2)
    const productionCall = calls.find((c) => c.body.event_kind === 'production_label')
    const shadowCall = calls.find((c) => c.body.event_kind === 'shadow_prediction')
    expect(productionCall).toBeDefined()
    expect(shadowCall).toBeDefined()
    expect(shadowCall!.body.producer_type).toBe('shadow_model')
    expect(shadowCall!.body.label_confidence).toBe('candidate')
    expect(shadowCall!.body.provider_id).toBe('workers-ai')
    expect(shadowCall!.body.model_id).toBe('@cf/some-org/shadow-model')
    expect(shadowCall!.body.model_version).toBe('2026-09-01')
  })

  // D. shadow model invalid JSON/schema -> no shadow row, production response unaffected.
  it('D: an invalid shadow model response appends the production_label but never a shadow_prediction row', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : {} })
      return new Response(null, { status: 201 })
    }))
    const aiRun = vi.fn(async () => ({ choices: [{ message: { content: 'not valid json' } }] }))

    await captureProductionRoutingTurn(baseParams({
      config: shadowConfig(),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }))

    expect(calls).toHaveLength(1)
    expect(calls[0].body.event_kind).toBe('production_label')
  })

  // E. shadow provider throws -> no fallback provider, no shadow row persisted.
  it('E: a throwing shadow provider appends the production_label but never a shadow_prediction row, and never throws itself', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : {} })
      return new Response(null, { status: 201 })
    }))
    const aiRun = vi.fn(async () => { throw new Error('binding exploded') })

    await expect(captureProductionRoutingTurn(baseParams({
      config: shadowConfig(),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }))).resolves.toBeUndefined()

    expect(calls).toHaveLength(1)
    expect(calls[0].body.event_kind).toBe('production_label')
  })

  // F. learning ledger append fails -> never throws (response unaffected
  // at this module's own boundary -- index.ts never awaits this at all).
  it('F: a persistence failure for the production_label append never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })))
    const logger = stubLogger()

    await expect(captureProductionRoutingTurn(baseParams(), { logger })).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })

  it('F: an unexpected synchronous throw anywhere inside is caught and never propagates', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('totally unexpected') }))
    const logger = stubLogger()

    await expect(captureProductionRoutingTurn(baseParams(), { logger })).resolves.toBeUndefined()
  })

  // H. rate 0 -> no shadow call.
  it('H: sampleRate 0 never calls the shadow provider, still appends the production_label', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : {} })
      return new Response(null, { status: 201 })
    }))
    const aiRun = vi.fn()

    await captureProductionRoutingTurn(baseParams({
      config: shadowConfig({ sampleRate: 0 }),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }))

    expect(aiRun).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  })

  // K. no raw message in ledger payload.
  it('K: the raw message never appears in any ai_learning_events insert body', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) bodies.push(String(init.body))
      return new Response(null, { status: 201 })
    }))
    const aiRun = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(VALID_SHADOW_PAYLOAD) } }] }))

    await captureProductionRoutingTurn(baseParams({
      config: shadowConfig(),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }))

    for (const body of bodies) {
      expect(body).not.toContain('SECRET_MARKER_DO_NOT_LEAK')
    }
    expect(bodies.length).toBeGreaterThan(0)
  })

  // L. no raw message in telemetry/log calls.
  it('L: the raw message never appears in any log() or error() call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })))
    const aiRun = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(VALID_SHADOW_PAYLOAD) } }] }))
    const logger = stubLogger()

    await captureProductionRoutingTurn(baseParams({
      config: shadowConfig(),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }), { logger })

    const allLoggedText = [...logger.log.mock.calls, ...logger.error.mock.calls].map((args) => args.join(' ')).join('\n')
    expect(allLoggedText).not.toContain('SECRET_MARKER_DO_NOT_LEAK')
    expect(allLoggedText).not.toContain(RAW_MESSAGE)
  })

  it('L: a provider failure also never logs the raw message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })))
    const aiRun = vi.fn(async () => { throw new Error(`failed on message: ${RAW_MESSAGE}`) })
    const logger = stubLogger()

    await captureProductionRoutingTurn(baseParams({
      config: shadowConfig(),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }), { logger })

    const allLoggedText = [...logger.log.mock.calls, ...logger.error.mock.calls].map((args) => args.join(' ')).join('\n')
    expect(allLoggedText).not.toContain('SECRET_MARKER_DO_NOT_LEAK')
  })

  // Q. shadow prediction can never be persisted with confidence above candidate.
  it('Q: the shadow_prediction event this module constructs always carries label_confidence=candidate', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : {} })
      return new Response(null, { status: 201 })
    }))
    // A malicious/malformed model response claiming a stronger confidence
    // inside its OWN payload is irrelevant -- labelConfidence is a
    // top-level ledger column this module sets itself, never read from
    // the model's output.
    const aiRun = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(VALID_SHADOW_PAYLOAD) } }] }))

    await captureProductionRoutingTurn(baseParams({
      config: shadowConfig(),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }))

    const shadowCall = calls.find((c) => c.body.event_kind === 'shadow_prediction')
    expect(shadowCall!.body.label_confidence).toBe('candidate')
  })

  it('never persists a shadow_prediction when the provider result is invalid', async () => {
    const shadowInserts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (body.event_kind === 'shadow_prediction') shadowInserts.push(body)
      return new Response(null, { status: 201 })
    }))
    const aiRun = vi.fn(async () => ({ choices: [{ message: { content: '{}' } }] }))

    await captureProductionRoutingTurn(baseParams({
      config: shadowConfig(),
      env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
    }))

    expect(shadowInserts).toHaveLength(0)
  })

  // Item 3 (ALF-1A correction): source_hash is computed once per
  // invocation and reused identically across every event this call
  // produces.
  describe('source_hash (item 3)', () => {
    it('is present, non-empty, and identical on both the production_label and shadow_prediction rows for the same turn', async () => {
      const bodies: Record<string, unknown>[] = []
      vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : {})
        return new Response(null, { status: 201 })
      }))
      const aiRun = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(VALID_SHADOW_PAYLOAD) } }] }))

      await captureProductionRoutingTurn(baseParams({
        config: shadowConfig(),
        env: testEnv({ AI: { run: aiRun } as unknown as Env['AI'] }),
      }))

      const productionCall = bodies.find((b) => b.event_kind === 'production_label')
      const shadowCall = bodies.find((b) => b.event_kind === 'shadow_prediction')
      expect(typeof productionCall?.source_hash).toBe('string')
      expect((productionCall?.source_hash as string).length).toBeGreaterThan(0)
      expect(productionCall?.source_hash).toBe(shadowCall?.source_hash)
    })

    it('matches computeSourceHash(rawMessage) and never equals the raw message text itself', async () => {
      const bodies: Record<string, unknown>[] = []
      vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : {})
        return new Response(null, { status: 201 })
      }))

      await captureProductionRoutingTurn(baseParams({ config: captureOnlyConfig() }))

      const expectedHash = await computeSourceHash(RAW_MESSAGE)
      const productionCall = bodies.find((b) => b.event_kind === 'production_label')
      expect(productionCall?.source_hash).toBe(expectedHash)
      expect(productionCall?.source_hash).not.toBe(RAW_MESSAGE)
    })
  })

  // Item 4 (ALF-1A correction): the top-level catch must never log
  // error.message/String(error)/stack/raw message -- only a fixed, bounded
  // reason string.
  it('item 4: an unexpected throw from a dependency (a logger call, standing in for "any dependency can throw") whose own Error message embeds the raw user message never leaks that message through any logger call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })))
    const logCalls: unknown[][] = []
    const errorCalls: unknown[][] = []
    const logger = {
      log: vi.fn((...args: unknown[]) => {
        logCalls.push(args)
        // Simulates an unexpected dependency failure whose own thrown
        // Error happens to embed the raw message -- e.g. a logging
        // transport, a future instrumentation hook, or any other
        // dependency this module calls without its own try/catch.
        throw new Error(`failure: ${RAW_MESSAGE}`)
      }),
      error: vi.fn((...args: unknown[]) => { errorCalls.push(args) }),
    }

    await expect(captureProductionRoutingTurn(baseParams({ config: captureOnlyConfig() }), { logger })).resolves.toBeUndefined()

    const allCallsText = [...logCalls, ...errorCalls].map((args) => args.join(' ')).join('\n')
    expect(allCallsText).not.toContain('SECRET_MARKER_DO_NOT_LEAK')
    expect(allCallsText).not.toContain(RAW_MESSAGE)
    // The bounded, fixed fallback line must actually have been emitted.
    expect(errorCalls.some((args) => String(args[0]).includes('status=failed') && String(args[0]).includes('reason=unexpected_error'))).toBe(true)
    // And it must never carry error.message/String(error)/stack content --
    // only the fixed line itself.
    for (const args of errorCalls) {
      expect(args).toHaveLength(1)
    }
  })
})
