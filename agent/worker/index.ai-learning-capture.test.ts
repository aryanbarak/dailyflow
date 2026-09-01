// ALF-1A (ADR-0021): integration coverage for the live-learning-capture
// wiring inside handleChat itself -- deliberately a SEPARATE, small,
// self-contained test file rather than growing index.test.ts's own
// 3000+-line fetch-mock harness. Exercises the actual `/chat` HTTP
// surface (via the real default-exported `worker.fetch`), not just the
// isolated ai-learning modules (already thoroughly covered by
// agent/worker/ai-learning/*.test.ts).
//
// Uses the mode==='off' deterministic-write branch as the test vehicle
// throughout: it is fully deterministic (no text-generation provider
// call needed at all), so this file needs no createProviders mock, unlike
// index.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import type { Env } from './types'
// Item 7 (ALF-1A correction): the conversational-path test below needs
// the plain-chat model call to succeed without hitting a real Gemini
// endpoint -- mocked at the SAME interface boundary index.test.ts's own
// harness uses (see that file's identical top-of-file setup), not at
// Gemini's wire format.
import { StubTextGenerationProvider, stubProviders } from './providers/testing/stubProviders'
import type { Providers } from './providers/createProviders'

let currentProviders: Providers = stubProviders()
vi.mock('./providers/createProviders', () => ({
  createProviders: (..._args: unknown[]) => currentProviders,
}))

const SUPABASE_URL = 'https://supa.test'
const USER_ID = 'user-1'
const SESSION_ID = 'session-1'
// Matches parseTaskWriteIntent's create-task pattern deterministically,
// with no calendar/finance trigger and no concrete time -- resolves to
// domain='tasks', action='create'.
const TASK_MESSAGE = 'Create a task to email the landlord'

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

function chatRequest(body: Record<string, unknown> = {}) {
  return new Request('https://worker.test/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer user-token',
      'Origin': 'https://barakzai.cloud',
    },
    body: JSON.stringify({
      message: TASK_MESSAGE,
      session_id: SESSION_ID,
      ...body,
    }),
  })
}

interface RouterOptions {
  flowWriteMode?: 'auto' | 'ask' | 'off'
  aiRun?: (model: string, inputs: Record<string, unknown>) => Promise<unknown>
}

interface CapturedRequest {
  url: string
  method: string
  body: Record<string, unknown> | undefined
}

// A minimal, purpose-built router -- NOT index.test.ts's installFetchMock
// (that harness's helper functions are file-local and not exported/
// reusable here by design; this file intentionally stays self-contained
// and small, matching the ai-learning module tests' own convention).
function installRouter(options: RouterOptions = {}) {
  const requests: CapturedRequest[] = []
  const mode = options.flowWriteMode ?? 'off'

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ url, method, body })

    if (url.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: USER_ID }), { status: 200 })
    }
    if (url.includes('/rest/v1/user_settings')) {
      return new Response(JSON.stringify([{ language: 'en' }]), { status: 200 })
    }
    if (url.includes('/rest/v1/personal_memory_records')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.includes('/rest/v1/flow_write_permissions')) {
      return new Response(JSON.stringify([{ mode }]), { status: 200 })
    }
    if (method === 'GET' && url.includes('/rest/v1/agent_chat_messages')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (method === 'POST' && url.includes('/rest/v1/agent_chat_messages')) {
      return new Response(null, { status: 201 })
    }
    if (method === 'POST' && url.includes('/rest/v1/ai_learning_events')) {
      return new Response(null, { status: 201 })
    }
    if (method === 'PATCH' && url.includes('/rest/v1/chat_sessions')) {
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unhandled fetch in test router: ${method} ${url}`)
  }))

  const aiRunSpy = vi.fn(options.aiRun ?? (async () => ({ choices: [{ message: { content: '{}' } }] })))

  return { requests, aiRunSpy }
}

function makeCtx() {
  const promises: Array<Promise<unknown>> = []
  const ctx = { waitUntil: vi.fn((p: Promise<unknown>) => { promises.push(p) }) } as unknown as ExecutionContext
  return { ctx, promises: () => promises }
}

describe('ALF-1A live-capture wiring inside /chat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    currentProviders = stubProviders()
  })

  // A. capture disabled -> zero learning writes, zero shadow calls.
  it('A: capture disabled (default env) never inserts into ai_learning_events and never calls env.AI', async () => {
    const { requests, aiRunSpy } = installRouter()
    const { ctx } = makeCtx()
    const env = testEnv({ AI: { run: aiRunSpy } as unknown as Env['AI'] })

    const response = await worker.fetch(chatRequest(), env, ctx)

    expect(response.status).toBe(200)
    expect(aiRunSpy).not.toHaveBeenCalled()
    expect(requests.some((r) => r.url.includes('ai_learning_events'))).toBe(false)
  })

  // B. capture enabled, shadow disabled -> production_label append only.
  it('B: AI_LEARNING_CAPTURE_ENABLED=true with shadow disabled appends only a production_label event', async () => {
    const { requests, aiRunSpy } = installRouter()
    const { ctx, promises } = makeCtx()
    const env = testEnv({
      AI: { run: aiRunSpy } as unknown as Env['AI'],
      AI_LEARNING_CAPTURE_ENABLED: 'true',
    })

    const response = await worker.fetch(chatRequest(), env, ctx)
    expect(response.status).toBe(200)
    await Promise.all(promises())

    expect(aiRunSpy).not.toHaveBeenCalled()
    const learningWrites = requests.filter((r) => r.method === 'POST' && r.url.includes('ai_learning_events'))
    expect(learningWrites).toHaveLength(1)
    expect(learningWrites[0].body?.event_kind).toBe('production_label')
  })

  // C. shadow enabled + rate 1 + valid model result -> production_label +
  // shadow_prediction candidate + correct provider/model/version provenance.
  it('C: shadow enabled with rate 1 and a valid model response appends both events with correct provenance', async () => {
    const validShadowPayload = {
      schemaVersion: 'intent-routing-v1',
      language: 'en',
      interactionClass: 'write',
      domain: 'tasks',
      intentType: 'create_task',
      toolId: 'tasks.create',
      requiresClarification: false,
      requiresApproval: false,
    }
    const { requests, aiRunSpy } = installRouter({
      aiRun: async () => ({ choices: [{ message: { content: JSON.stringify(validShadowPayload) } }] }),
    })
    const { ctx, promises } = makeCtx()
    const env = testEnv({
      AI: { run: aiRunSpy } as unknown as Env['AI'],
      AI_LEARNING_CAPTURE_ENABLED: 'true',
      AI_SHADOW_ENABLED: 'true',
      AI_SHADOW_PROVIDER: 'workers-ai',
      AI_SHADOW_MODEL_ID: '@cf/some-org/shadow-model',
      AI_SHADOW_MODEL_VERSION: '2026-09-01',
      AI_SHADOW_SAMPLE_RATE: '1',
    })

    const response = await worker.fetch(chatRequest(), env, ctx)
    expect(response.status).toBe(200)
    await Promise.all(promises())

    expect(aiRunSpy).toHaveBeenCalledTimes(1)
    const learningWrites = requests.filter((r) => r.method === 'POST' && r.url.includes('ai_learning_events'))
    expect(learningWrites).toHaveLength(2)
    const shadowWrite = learningWrites.find((r) => r.body?.event_kind === 'shadow_prediction')
    expect(shadowWrite?.body?.producer_type).toBe('shadow_model')
    expect(shadowWrite?.body?.label_confidence).toBe('candidate')
    expect(shadowWrite?.body?.provider_id).toBe('workers-ai')
    expect(shadowWrite?.body?.model_id).toBe('@cf/some-org/shadow-model')
    expect(shadowWrite?.body?.model_version).toBe('2026-09-01')
  })

  // G. deferred shadow promise -> /chat response resolves without
  // awaiting it; promise is registered with ctx.waitUntil.
  it('G: the HTTP response resolves without ever awaiting the shadow work, and the work is registered via ctx.waitUntil', async () => {
    // A shadow provider call that NEVER resolves during this test -- if
    // the /chat response depended on it in any way, `worker.fetch(...)`
    // below would hang and this test would time out. It doesn't, which is
    // the actual proof of "deferred, not awaited" -- not a race against
    // precise microtask interleaving (see test C for the case where the
    // deferred work is later awaited to completion and verified).
    const aiRun = vi.fn(() => new Promise(() => { /* never resolves */ }))
    installRouter()
    const { ctx } = makeCtx()
    const env = testEnv({
      AI: { run: aiRun } as unknown as Env['AI'],
      AI_LEARNING_CAPTURE_ENABLED: 'true',
      AI_SHADOW_ENABLED: 'true',
      AI_SHADOW_PROVIDER: 'workers-ai',
      AI_SHADOW_MODEL_ID: '@cf/some-org/shadow-model',
      AI_SHADOW_MODEL_VERSION: '2026-09-01',
      AI_SHADOW_SAMPLE_RATE: '1',
    })

    const response = await worker.fetch(chatRequest(), env, ctx)

    expect(response.status).toBe(200)
    expect(ctx.waitUntil).toHaveBeenCalled()
    // ctx.waitUntil was handed a Promise, not a value already resolved
    // before the response returned -- proving the deferred work is still
    // in flight (specifically, still stuck inside the never-resolving
    // aiRun call) at the moment the response was already sent.
    const registeredCall = (ctx.waitUntil as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(registeredCall).toBeInstanceOf(Promise)

    // The overall registered promise never settles (by design -- aiRun
    // never resolves), but its EARLIER production_label append does settle
    // on its own, independently of the permanently-stuck shadow step. Give
    // it a moment to finish here, while THIS test's own router/mocks are
    // still installed, so that side effect can't leak into whichever test
    // runs next (a real, if rare, test-isolation hazard with any
    // deliberately-abandoned fire-and-forget promise).
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  // T. exact durable source message ID is used -> no latest-message/
  // content lookup.
  it('T: the ai_learning_events source_message_id is the SAME id the agent_chat_messages user row was inserted with -- no second lookup', async () => {
    const { requests, aiRunSpy } = installRouter()
    const { ctx, promises } = makeCtx()
    const env = testEnv({
      AI: { run: aiRunSpy } as unknown as Env['AI'],
      AI_LEARNING_CAPTURE_ENABLED: 'true',
    })

    await worker.fetch(chatRequest(), env, ctx)
    await Promise.all(promises())

    const userMessageInsert = requests.find((r) => r.method === 'POST' && r.url.includes('agent_chat_messages') && r.body?.role === 'user')
    // Matched by source_message_id, not just "the first ai_learning_events
    // POST this test's array happened to receive" -- this is what the
    // test actually claims to prove, and stays correct even if an
    // unrelated background write (e.g. a prior test's deliberately
    // abandoned fire-and-forget promise, see test G) ever lands here too.
    const learningWrite = requests.find((r) => r.method === 'POST' && r.url.includes('ai_learning_events') && r.body?.source_message_id === userMessageInsert?.body?.id)
    expect(userMessageInsert?.body?.id).toBeDefined()
    expect(typeof userMessageInsert?.body?.id).toBe('string')
    expect(learningWrite?.body?.source_message_id).toBe(userMessageInsert?.body?.id)

    // No GET query against agent_chat_messages happens AFTER the user
    // message insert to "find" the row that was just written (the only
    // GET against that table is the earlier, pre-existing history load,
    // which happens BEFORE this turn's own message is inserted at all) --
    // proving there is no find-by-content/timestamp lookup anywhere in
    // this flow.
    const chatMessageGets = requests.filter((r) => r.method === 'GET' && r.url.includes('agent_chat_messages'))
    expect(chatMessageGets).toHaveLength(1)
  })

  it('the id used for source_message_id is a well-formed UUID, not a counter or timestamp string', async () => {
    const { requests, aiRunSpy } = installRouter()
    const { ctx, promises } = makeCtx()
    const env = testEnv({
      AI: { run: aiRunSpy } as unknown as Env['AI'],
      AI_LEARNING_CAPTURE_ENABLED: 'true',
    })

    await worker.fetch(chatRequest(), env, ctx)
    await Promise.all(promises())

    const learningWrite = requests.find((r) => r.method === 'POST' && r.url.includes('ai_learning_events'))
    expect(learningWrite?.body?.source_message_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  // Item 7 (ALF-1A correction): real integration coverage using the
  // ACTUAL deterministic routing path (detectWriteDomainSignal ->
  // assembleTaskWriteIntent/assembleCalendarWriteIntent), not the label
  // assembler called directly with hand-supplied fields. mode='off' is
  // used deliberately (per the correction's own instruction) -- it
  // exercises the real parse-and-classify path while guaranteeing zero
  // consequential mutation (no task/event is actually created).
  describe('section 7: real Persian routing integration', () => {
    it('A: an exact-clock-time Persian task-noun message captures write/calendar/create_calendar_event/calendar.create_event', async () => {
      const { requests, aiRunSpy } = installRouter({ flowWriteMode: 'off' })
      const { ctx, promises } = makeCtx()
      const env = testEnv({
        AI: { run: aiRunSpy } as unknown as Env['AI'],
        AI_LEARNING_CAPTURE_ENABLED: 'true',
      })
      const message = 'برای فردا ساعت ۱۰ یک تسک بساز که به احمد زنگ بزنم'

      const response = await worker.fetch(chatRequest({ message }), env, ctx)
      expect(response.status).toBe(200)
      await Promise.all(promises())

      const learningWrite = requests.find((r) => r.method === 'POST' && r.url.includes('ai_learning_events'))
      expect(learningWrite?.body?.event_kind).toBe('production_label')
      const payload = learningWrite?.body?.payload as Record<string, unknown> | undefined
      expect(payload?.domain).toBe('calendar')
      expect(payload?.intentType).toBe('create_calendar_event')
      expect(payload?.toolId).toBe('calendar.create_event')
      // Item 6: production label language is always 'unknown' -- never the
      // user's response-language preference.
      expect(payload?.language).toBe('unknown')
    })

    it('B: a date-only (no clock time) Persian task-noun message captures write/tasks/create_task/tasks.create', async () => {
      const { requests, aiRunSpy } = installRouter({ flowWriteMode: 'off' })
      const { ctx, promises } = makeCtx()
      const env = testEnv({
        AI: { run: aiRunSpy } as unknown as Env['AI'],
        AI_LEARNING_CAPTURE_ENABLED: 'true',
      })
      const message = 'برای فردا یک تسک بساز که به احمد زنگ بزنم'

      const response = await worker.fetch(chatRequest({ message }), env, ctx)
      expect(response.status).toBe(200)
      await Promise.all(promises())

      const learningWrite = requests.find((r) => r.method === 'POST' && r.url.includes('ai_learning_events'))
      expect(learningWrite?.body?.event_kind).toBe('production_label')
      const payload = learningWrite?.body?.payload as Record<string, unknown> | undefined
      expect(payload?.domain).toBe('tasks')
      expect(payload?.intentType).toBe('create_task')
      expect(payload?.toolId).toBe('tasks.create')
    })

    it('a normal read/non-write turn never gets a fabricated production_label (item 1: capture point removed)', async () => {
      currentProviders = stubProviders({
        text: new StubTextGenerationProvider(async () => ({ text: 'I am doing well, thanks for asking!', finishReason: 'stop' })),
      })
      const { requests, aiRunSpy } = installRouter()
      const { ctx, promises } = makeCtx()
      const env = testEnv({
        AI: { run: aiRunSpy } as unknown as Env['AI'],
        AI_LEARNING_CAPTURE_ENABLED: 'true',
      })

      const response = await worker.fetch(chatRequest({ message: 'Hello, how are you today?' }), env, ctx)
      expect(response.status).toBe(200)
      await Promise.all(promises())

      expect(aiRunSpy).not.toHaveBeenCalled()
      expect(requests.some((r) => r.url.includes('ai_learning_events'))).toBe(false)
    })
  })

  // ALF-1A correction (round 2, item 3): the staged pendingWritePolicy/ask
  // capture must never fire if the durable user-message insert it depends
  // on itself fails -- and on success, must always follow that insert.
  describe('section 3: durable-insert failure/order regression (round 2, item 3)', () => {
    it('a failed user agent_chat_messages insert for the staged ask-mode capture never calls ctx.waitUntil and never posts to ai_learning_events, and /chat keeps its existing failure behavior', async () => {
      currentProviders = stubProviders({
        text: new StubTextGenerationProvider(async () => ({ text: 'Sure, want me to go ahead?', finishReason: 'stop' })),
      })
      const requests: CapturedRequest[] = []
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ url, method, body })

        if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: USER_ID }), { status: 200 })
        if (url.includes('/rest/v1/user_settings')) return new Response(JSON.stringify([{ language: 'en' }]), { status: 200 })
        if (url.includes('/rest/v1/personal_memory_records')) return new Response(JSON.stringify([]), { status: 200 })
        if (url.includes('/rest/v1/flow_write_permissions')) return new Response(JSON.stringify([{ mode: 'ask' }]), { status: 200 })
        if (method === 'GET' && url.includes('/rest/v1/agent_chat_messages')) return new Response(JSON.stringify([]), { status: 200 })
        // Only the USER-role insert fails -- this is the exact row this
        // turn's staged capture depends on existing durably before firing.
        if (method === 'POST' && url.includes('/rest/v1/agent_chat_messages') && body?.role === 'user') {
          return new Response(JSON.stringify({ message: 'insert failed' }), { status: 500 })
        }
        if (method === 'POST' && url.includes('/rest/v1/agent_chat_messages')) return new Response(null, { status: 201 })
        if (method === 'POST' && url.includes('/rest/v1/ai_learning_events')) return new Response(null, { status: 201 })
        if (method === 'PATCH' && url.includes('/rest/v1/chat_sessions')) return new Response(null, { status: 204 })
        throw new Error(`Unhandled fetch in test router: ${method} ${url}`)
      }))
      const { ctx, promises } = makeCtx()
      const env = testEnv({ AI_LEARNING_CAPTURE_ENABLED: 'true' })

      const response = await worker.fetch(chatRequest(), env, ctx)
      // Pre-existing /chat failure behavior (task 22-fix2 D2, unchanged by
      // ALF-1A): any turn failure not otherwise handled degrades to a
      // clean 200 with the generic honest-retry reply, never a bare 500.
      expect(response.status).toBe(200)
      const body = await response.json() as { reply: string }
      expect(body.reply).toBe('Something went wrong on my end. Please try again.')
      await Promise.all(promises())

      expect(ctx.waitUntil).not.toHaveBeenCalled()
      expect(requests.some((r) => r.url.includes('ai_learning_events'))).toBe(false)
    })

    it('on success, the user agent_chat_messages insert happens BEFORE the ai_learning_events insert for the staged ask-mode capture', async () => {
      currentProviders = stubProviders({
        text: new StubTextGenerationProvider(async () => ({ text: 'Sure, want me to go ahead?', finishReason: 'stop' })),
      })
      const { requests } = installRouter({ flowWriteMode: 'ask' })
      const { ctx, promises } = makeCtx()
      const env = testEnv({ AI_LEARNING_CAPTURE_ENABLED: 'true' })

      await worker.fetch(chatRequest(), env, ctx)
      await Promise.all(promises())

      const userInsertIndex = requests.findIndex((r) => r.method === 'POST' && r.url.includes('agent_chat_messages') && r.body?.role === 'user')
      const learningIndex = requests.findIndex((r) => r.method === 'POST' && r.url.includes('ai_learning_events'))
      expect(userInsertIndex).toBeGreaterThanOrEqual(0)
      expect(learningIndex).toBeGreaterThanOrEqual(0)
      expect(userInsertIndex).toBeLessThan(learningIndex)
    })
  })
})
