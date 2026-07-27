import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import type { Env } from './types'

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

function chatRequest(body: Record<string, unknown>) {
  return new Request('https://worker.test/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer user-token',
      'Origin': 'https://barakzai.cloud',
    },
    body: JSON.stringify({
      message: 'Show my tasks',
      session_id: 'session-1',
      ...body,
    }),
  })
}

interface FetchLog {
  geminiCalls: Array<{ system_instruction?: unknown; generationConfig?: any }>
  chatMessageWrites: Array<Record<string, unknown>>
  sessionPatches: number
}

function installFetchMock(): FetchLog {
  const log: FetchLog = { geminiCalls: [], chatMessageWrites: [], sessionPatches: 0 }

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      return new Response(JSON.stringify({ id: 'user-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/user_settings`)) {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/user_context`)) {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages`) && method === 'GET') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/agent_chat_messages`) && method === 'POST') {
      log.chatMessageWrites.push(JSON.parse(String(init?.body)))
      return new Response(null, { status: 201 })
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/chat_sessions`) && method === 'PATCH') {
      log.sessionPatches += 1
      return new Response(null, { status: 204 })
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      const parsedBody = JSON.parse(String(init?.body))
      log.geminiCalls.push(parsedBody)
      const schema = parsedBody.generationConfig?.responseSchema

      if (schema?.type === 'ARRAY') {
        // Background memory-extraction call
        return new Response(
          JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[]' }] } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (schema?.type === 'OBJECT') {
        // Schema-enforced reasoning call
        const proposal = JSON.stringify({
          type: 'inspect_tasks',
          confidence: 'high',
          reasons: ['The request asks to inspect active tasks.'],
          language: 'en',
        })
        return new Response(
          JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: proposal }] } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      // Plain conversational chat call
      return new Response(
        JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Hello from Gemini' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })

  vi.stubGlobal('fetch', mock)
  return log
}

function fakeExecutionContext() {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext
}

describe('handleChat mode routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mode: "reasoning" schema-enforces the Gemini call and persists nothing to agent_chat_messages', async () => {
    const log = installFetchMock()
    const ctx = fakeExecutionContext()
    const env = testEnv()

    const response = await worker.fetch(
      chatRequest({ message: 'Reasoning prompt text', mode: 'reasoning', responseLanguage: 'en' }),
      env,
      ctx,
    )
    const body = await response.json() as { reply?: string }

    expect(response.status).toBe(200)
    expect(JSON.parse(body.reply ?? '{}')).toMatchObject({ type: 'inspect_tasks' })

    expect(log.geminiCalls).toHaveLength(1)
    const [call] = log.geminiCalls
    expect(call.generationConfig.temperature).toBe(0)
    expect(call.generationConfig.responseMimeType).toBe('application/json')
    expect(call.generationConfig.responseSchema.properties.type.enum).toEqual([
      'inspect_tasks',
      'inspect_calendar',
      'inspect_learning',
      'inspect_workspace',
      'inspect_github_repositories',
      'inspect_github_issues',
      'inspect_github_epics',
      'inspect_github_pull_requests',
      'inspect_github_workflow_runs',
      'complete_task',
      'ask_clarification',
      'unsupported',
    ])
    expect(call.generationConfig.responseSchema.properties.confidence.enum).toEqual(['low', 'medium', 'high'])
    expect(call.generationConfig.responseSchema.properties.candidates.items.properties.type.enum).toEqual(
      call.generationConfig.responseSchema.properties.type.enum,
    )

    expect(log.chatMessageWrites).toHaveLength(0)
    expect(log.sessionPatches).toBe(0)
    expect((ctx.waitUntil as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('mode absent behaves exactly like plain chat: unchanged persistence and config', async () => {
    const log = installFetchMock()
    const ctx = fakeExecutionContext()
    const env = testEnv()

    const response = await worker.fetch(chatRequest({ message: 'Hello there' }), env, ctx)
    const body = await response.json() as { reply?: string }

    expect(response.status).toBe(200)
    expect(body.reply).toBe('Hello from Gemini')

    expect(log.chatMessageWrites).toHaveLength(2)
    expect(log.chatMessageWrites[0]).toMatchObject({ role: 'user', content: 'Hello there' })
    expect(log.chatMessageWrites[1]).toMatchObject({ role: 'assistant', content: 'Hello from Gemini' })
    expect(log.sessionPatches).toBe(1)

    // Background memory extraction is still scheduled for a real chat turn.
    expect((ctx.waitUntil as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)

    const chatCall = log.geminiCalls.find((call) => !call.generationConfig?.responseSchema)
    expect(chatCall).toBeDefined()
    expect(chatCall?.generationConfig.temperature).toBe(0.7)
  })

  it('an unknown mode value is treated as "chat", not an error', async () => {
    const log = installFetchMock()
    const ctx = fakeExecutionContext()
    const env = testEnv()

    const response = await worker.fetch(
      chatRequest({ message: 'Hello there', mode: 'not-a-real-mode' }),
      env,
      ctx,
    )
    const body = await response.json() as { reply?: string }

    expect(response.status).toBe(200)
    expect(body.reply).toBe('Hello from Gemini')
    expect(log.chatMessageWrites).toHaveLength(2)
    expect(log.sessionPatches).toBe(1)
  })
})
